const parameterVisitor = require("babel-plugin-transform-es2015-parameters/lib/destructuring").visitor;
const destructuringVisitor = require("babel-plugin-transform-es2015-destructuring/lib/index");

import { visitors } from "babel-traverse";

export default function ({ types: t }) {
  function hasSpread(node) {
    for (let prop of (node.properties: Array<Object>)) {
      if (t.isSpreadProperty(prop)) {
        return true;
      }
    }
    return false;
  }

  function createObjectSpread(file, props, objRef) {
    const restProperty = props.pop();

    let keys = [];
    for (let prop of props) {
      let key = prop.key;
      if (t.isIdentifier(key) && !prop.computed) {
        key = t.stringLiteral(prop.key.name);
      }
      keys.push(key);
    }

    return t.variableDeclarator(
      restProperty.argument,
      t.callExpression(
        file.addHelper("objectWithoutProperties"), [
          objRef,
          t.arrayExpression(keys)
        ]
      )
    );
  }

  return {
    inherits: require("babel-plugin-syntax-object-rest-spread"),

    visitor: visitors.merge([parameterVisitor, destructuringVisitor, {
      // taken from transform-es2015-parameters/src/destructuring.js
      Function(path) {
        let params = path.get("params");

        // If there's a rest param, no need to loop through it. Also, we need to
        // hoist one more level to get `declar` at the right spot.
        let hoistTweak = t.isRestProperty(params[params.length - 1]) ? 1 : 0;
        let outputParamsLength = params.length - hoistTweak;

        for (let i = 0; i < outputParamsLength; i++) {
          let param = params[i];
          if (param.isObjectPattern()) {
            let uid = path.scope.generateUidIdentifier("ref");

            let declar = t.variableDeclaration("let", [
              t.variableDeclarator(param.node, uid)
            ]);
            declar._blockHoist = outputParamsLength - i;

            path.ensureBlock();
            path.get("body").unshiftContainer("body", declar);

            param.replaceWith(uid);
          }
        }
      },
      // adapted from transform-es2015-destructuring/src/index.js#pushObjectRest
      VariableDeclarator(path, file) {
        if (!path.get("id").isObjectPattern()) { return; }
        const kind = path.parentPath.node.kind;
        let nodes = [];

        path.traverse({
          RestProperty(path) {
            if (!this.originalPath.node) {
              return;
            }

            let ref = this.originalPath.node.init;

            path.findParent((path) => {
              if (path.isObjectProperty()) {
                ref = t.memberExpression(ref, t.identifier(path.node.key.name));
              } else if (path.isVariableDeclarator()) {
                return true;
              }
            });

            nodes.push(
              createObjectSpread(
                file,
                path.parentPath.node.properties,
                ref
              )
            );

            if (path.parentPath.node.properties.length === 0) {
              path.findParent(
                (path) => path.isObjectProperty() || path.isVariableDeclaration()
              ).remove();
            }

          }
        },{
          originalPath: path
        });

        if (nodes.length > 0) {
          path.parentPath.getSibling(path.parentPath.key + 1)
            .insertBefore(
            t.variableDeclaration(kind, nodes)
          );
        }
      },
      ObjectExpression(path, file) {
        if (!hasSpread(path.node)) return;

        let useBuiltIns = file.opts.useBuiltIns || false;
        if (typeof useBuiltIns !== "boolean") {
          throw new Error("transform-object-rest-spread currently only accepts a boolean option for useBuiltIns (defaults to false)");
        }

        let args = [];
        let props = [];

        function push() {
          if (!props.length) return;
          args.push(t.objectExpression(props));
          props = [];
        }

        for (let prop of (path.node.properties: Array)) {
          if (t.isSpreadProperty(prop)) {
            push();
            args.push(prop.argument);
          } else {
            props.push(prop);
          }
        }

        push();

        if (!t.isObjectExpression(args[0])) {
          args.unshift(t.objectExpression([]));
        }

        const helper = useBuiltIns ?
          t.memberExpression(t.identifier("Object"), t.identifier("assign")) :
          file.addHelper("extends");

        path.replaceWith(t.callExpression(helper, args));
      }
    }])
  };
}
