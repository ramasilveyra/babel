"use strict";

const fs = require("fs");
const path = require("path");

const flatten = require("lodash/flatten");
const flattenDeep = require("lodash/flattenDeep");
const mapValues = require("lodash/mapValues");
const pluginFeatures = require("../data/plugin-features");
const builtInFeatures = require("../data/built-in-features");

const renameTests = (tests, getName) =>
  tests.map(test => Object.assign({}, test, { name: getName(test.name) }));

const es6Data = require("compat-table/data-es6");
const es6PlusData = require("compat-table/data-es2016plus");
const envs = require("compat-table/environments");

const environments = [
  "chrome",
  "opera",
  "edge",
  "firefox",
  "safari",
  "node",
  "ie",
  "android",
  "ios",
  "phantom",
];

const envMap = {
  safari51: "safari5",
  safari71_8: "safari8",
  safari10_1: "safari10.1",
  firefox3_5: "firefox3",
  firefox3_6: "firefox3",
  node010: "node0.10",
  node012: "node0.12",
  iojs: "node3.3",
  node64: "node6",
  node65: "node6.5",
  node76: "node7.6",
  android40: "android4.0",
  android41: "android4.1",
  android42: "android4.2",
  android43: "android4.3",
  android44: "android4.4",
  android50: "android5.0",
  android51: "android5.1",
  ios51: "ios5.1",
};

const invertedEqualsEnv = Object.keys(envs).filter(b => envs[b].equals).reduce((
  a,
  b,
) => {
  const checkEnv = envMap[envs[b].equals] || envs[b].equals;
  environments.some(env => {
    // go through all environment names to find the the current one
    // and try to get the version as integer
    const version = parseFloat(checkEnv.replace(env, ""));
    if (!isNaN(version)) {
      Object.keys(envs).forEach(equals => {
        equals = envMap[equals] || equals;
        // Go through all envs from compat-table and get int version
        const equalsVersion = parseFloat(equals.replace(env, ""));
        // If the current version is smaller than the version that was mentioned
        // in `equals` we can add an entry, as older versions should include features
        // that newer ones have
        if (!isNaN(equalsVersion) && equalsVersion <= version) {
          if (!a[equals]) a[equals] = [];
          if (a[equals].indexOf(b) >= 0) return;
          a[equals].push(b);
        }
      });
      return true;
    }
  });

  return a;
}, {});

const compatibilityTests = flattenDeep(
  [es6Data, es6PlusData].map(data =>
    data.tests.map(test => {
      return test.subtests
        ? [test, renameTests(test.subtests, name => test.name + " / " + name)]
        : test;
    })),
);

const getLowestImplementedVersion = ({ features }, env) => {
  const tests = flatten(
    compatibilityTests
      .filter(test => {
        return features.indexOf(test.name) >= 0 ||
          // for features === ["DataView"]
          // it covers "DataView (Int8)" and "DataView (UInt8)"
          (features.length === 1 && test.name.indexOf(features[0]) === 0);
      })
      .map(test => {
        const isBuiltIn = test.category === "built-ins" ||
          test.category === "built-in extensions";

        return test.subtests
          ? test.subtests.map(subtest => ({
              name: `${test.name}/${subtest.name}`,
              res: subtest.res,
              isBuiltIn,
            }))
          : {
              name: test.name,
              res: test.res,
              isBuiltIn,
            };
      }),
  );

  const envTests = tests.map(({ res: test, name, isBuiltIn }, i) => {
    // Babel itself doesn't implement the feature correctly,
    // don't count against it
    // only doing this for built-ins atm
    if (!test.babel && isBuiltIn) {
      return "-1";
    }

    // `equals` in compat-table
    Object.keys(test).forEach(t => {
      const invertedEnvs = invertedEqualsEnv[envMap[t] || t];
      if (invertedEnvs) {
        invertedEnvs.forEach(inv => {
          test[inv] = test[t];
        });
      }
    });

    return (
      Object.keys(test)
        .filter(t => t.startsWith(env))
        // Babel assumes strict mode
        .filter(
          test =>
            tests[i].res[test] === true || tests[i].res[test] === "strict",
        )
        // normalize some keys
        .map(test => envMap[test] || test)
        .filter(test => !isNaN(parseFloat(test.replace(env, ""))))
        .shift()
    );
  });

  const envFiltered = envTests.filter(t => t);
  if (envTests.length > envFiltered.length || envTests.length === 0) {
    // envTests.forEach((test, i) => {
    //   if (!test) {
    //     // print unsupported features
    //     if (env === 'node') {
    //       console.log(`ENV(${env}): ${tests[i].name}`);
    //     }
    //   }
    // });
    return null;
  }

  return envTests.map(str => Number(str.replace(env, ""))).reduce((a, b) => {
    return a < b ? b : a;
  });
};

const generateData = (environments, features) => {
  return mapValues(features, options => {
    if (!options.features) {
      options = {
        features: [options],
      };
    }

    const plugin = {};
    environments.forEach(env => {
      const version = getLowestImplementedVersion(options, env);
      if (version !== null) {
        plugin[env] = version;
      }
    });

    // add opera
    if (plugin.chrome) {
      if (plugin.chrome >= 28) {
        plugin.opera = plugin.chrome - 13;
      } else if (plugin.chrome === 5) {
        plugin.opera = 12;
      }
    }

    return plugin;
  });
};

fs.writeFileSync(
  path.join(__dirname, "../data/plugins.json"),
  JSON.stringify(generateData(environments, pluginFeatures), null, 2) + "\n",
);

fs.writeFileSync(
  path.join(__dirname, "../data/built-ins.json"),
  JSON.stringify(generateData(environments, builtInFeatures), null, 2) + "\n",
);
