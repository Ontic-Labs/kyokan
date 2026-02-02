/**
 * ESLint rule: no-hardcoded-css
 *
 * Bans hardcoded CSS color values in className and style props.
 * All colors must use semantic design tokens defined in globals.css.
 *
 * See: ai/rules/semantic-design-tokens.yaml
 */

const BANNED_CLASS_PATTERNS = [
  // Raw Tailwind color utilities (bg-red-500, text-gray-200, etc.)
  /\b(bg|text|border|ring|outline|shadow|divide|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(-\d+)?\b/,
  // Arbitrary color values in brackets
  /\b(bg|text|border|ring|outline|shadow|divide)-\[#[0-9a-fA-F]+\]/,
  /\b(bg|text|border|ring|outline|shadow|divide)-\[rgb/,
  /\b(bg|text|border|ring|outline|shadow|divide)-\[hsl/,
];

const BANNED_STYLE_PATTERNS = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\brgb\(/,
  /\brgba\(/,
  /\bhsl\(/,
  /\bhsla\(/,
];

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hardcoded CSS color values. Use semantic design tokens instead.",
    },
    messages: {
      noHardcodedClass:
        "Hardcoded color class '{{value}}' is banned. Use a semantic token class (e.g., bg-surface, text-text-primary, border-border-default). See ai/rules/semantic-design-tokens.yaml.",
      noHardcodedStyle:
        "Hardcoded color value in inline style is banned. Use a CSS custom property (e.g., var(--token-...)). See ai/rules/semantic-design-tokens.yaml.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        // Check className for banned color classes
        if (node.name.name === "className" && node.value) {
          const raw =
            node.value.type === "Literal" ? node.value.value : null;
          if (typeof raw === "string") {
            for (const pattern of BANNED_CLASS_PATTERNS) {
              const match = raw.match(pattern);
              if (match) {
                context.report({
                  node,
                  messageId: "noHardcodedClass",
                  data: { value: match[0] },
                });
                break;
              }
            }
          }
          // Check template literals in className={`...`}
          if (
            node.value.type === "JSXExpressionContainer" &&
            node.value.expression.type === "TemplateLiteral"
          ) {
            for (const quasi of node.value.expression.quasis) {
              const str = quasi.value.raw;
              for (const pattern of BANNED_CLASS_PATTERNS) {
                const match = str.match(pattern);
                if (match) {
                  context.report({
                    node: quasi,
                    messageId: "noHardcodedClass",
                    data: { value: match[0] },
                  });
                  break;
                }
              }
            }
          }
        }

        // Check style prop for hardcoded color values
        if (node.name.name === "style" && node.value) {
          const expr =
            node.value.type === "JSXExpressionContainer"
              ? node.value.expression
              : null;
          if (expr && expr.type === "ObjectExpression") {
            for (const prop of expr.properties) {
              if (
                prop.value &&
                prop.value.type === "Literal" &&
                typeof prop.value.value === "string"
              ) {
                for (const pattern of BANNED_STYLE_PATTERNS) {
                  if (pattern.test(prop.value.value)) {
                    context.report({
                      node: prop,
                      messageId: "noHardcodedStyle",
                    });
                    break;
                  }
                }
              }
            }
          }
        }
      },
    };
  },
};
