import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Task 17: efek berbadan ekspresi (`useEffect(() => el.scrollIntoView())`) mengembalikan nilai panggilan. Chrome 149/150+
    // mengembalikan Promise dari scrollIntoView/scrollTo/scrollBy; React menyimpannya sebagai cleanup lalu memanggilnya
    // ("i is not a function") dan halaman jatuh ke error.tsx. Badan efek wajib berupa blok { ... }.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name=/^use(Layout|Insertion)?Effect$/] > ArrowFunctionExpression:first-child[body.type!='BlockStatement']",
          message: "Badan efek harus blok { ... }: nilai kembalian dipakai React sebagai cleanup (Task 17).",
        },
        {
          selector: "CallExpression[callee.object.name='React'][callee.property.name=/^use(Layout|Insertion)?Effect$/] > ArrowFunctionExpression:first-child[body.type!='BlockStatement']",
          message: "Badan efek harus blok { ... }: nilai kembalian dipakai React sebagai cleanup (Task 17).",
        },
      ],
    },
  },
  globalIgnores([".next/**", "node_modules/**", ".superpowers/**", "next-env.d.ts"]),
]);
