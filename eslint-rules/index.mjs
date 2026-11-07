// Local ESLint rules for exact money, quantity, dose and weight handling (SCHEMA G2-G3, G12).

const MONEY_NAME = /(amount|price|qty|quantity|minor|cash|fee|cost|balance|limit|total|deposit|dose|wt|weight|kg|mg|ml|strength|concentration|rate|volume|tax|discount|refund|credit|charge|value)/i;

function nameOf(node) {
  if (!node) return "";
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") return node.property?.type === "Identifier" ? node.property.name : nameOf(node.object);
  if (node.type === "ChainExpression") return nameOf(node.expression);
  if (node.type === "CallExpression") return nameOf(node.callee);
  if (node.type === "TSNonNullExpression" || node.type === "TSAsExpression") return nameOf(node.expression);
  return "";
}

/** Blocks floating-point conversion of money, price and quantity values. Counts and ids may still use Number(). */
const noNumberOnMoney = {
  meta: {
    type: "problem",
    docs: { description: "Money, quantities, doses and weights stay in BigInt or decimal.js; no float conversion" },
    messages: {
      parseFloat: "parseFloat is not allowed in money code. Use dec() from lib/decimal.",
      toFixed: "toFixed() rounds a float. Use lib/decimal formatting on a Decimal.",
      toNumber: "toNumber() turns an exact Decimal into a float. Keep it a Decimal or a string.",
      numberCall: "Number({{name}}) makes a money/price/quantity value a float. Use dec() or BigInt.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "Identifier" && callee.name === "parseFloat") context.report({ node, messageId: "parseFloat" });
        if (callee.type === "MemberExpression" && callee.property?.type === "Identifier") {
          if (callee.object?.type === "Identifier" && callee.object.name === "Number" && callee.property.name === "parseFloat") context.report({ node, messageId: "parseFloat" });
          if (callee.property.name === "toFixed") context.report({ node, messageId: "toFixed" });
          if (callee.property.name === "toNumber") context.report({ node, messageId: "toNumber" });
        }
        if (callee.type === "Identifier" && callee.name === "Number" && node.arguments.length === 1) {
          const name = nameOf(node.arguments[0]);
          if (name && MONEY_NAME.test(name)) context.report({ node, messageId: "numberCall", data: { name } });
        }
      },
    };
  },
};

// No float fields at all (G12): money is bigInt minor units, everything measured is decimal.
const FLOAT_ALLOWED = new Set([]);

const noFloatFields = {
  meta: {
    type: "problem",
    docs: { description: "No float() fields: money, doses, weights and coordinates are exact" },
    messages: { float: "float() field '{{key}}' is not allowed. Use decimal(), bigInt() minor units or integer bps (SCHEMA G12)." },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "float") return;
        const parent = node.parent;
        const key = parent?.type === "Property" ? (parent.key.type === "Identifier" ? parent.key.name : String(parent.key.value)) : "";
        if (!FLOAT_ALLOWED.has(key)) context.report({ node, messageId: "float", data: { key: key || "?" } });
      },
    };
  },
};

export default {
  meta: { name: "vet-clinic" },
  rules: { "no-number-on-money": noNumberOnMoney, "no-float-fields": noFloatFields },
};
