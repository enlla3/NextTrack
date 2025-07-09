// eslint.config.mjs
export default [
	{
		// Skip linting dependencies
		ignores: ["node_modules/**"],

		// Treat all files as ES Modules, modern JS
		languageOptions: {
			parserOptions: {
				ecmaVersion: "latest",
				sourceType: "module",
			},
			globals: {
				// Node.js globals
				process: "readonly",
				require: "readonly",
				module: "readonly",
				__dirname: "readonly",
				console: "readonly",
				// Jest
				jest: "readonly",
				describe: "readonly",
				it: "readonly",
				expect: "readonly",
				beforeEach: "readonly",
				afterEach: "readonly",
				beforeAll: "readonly",
				afterAll: "readonly",
			},
		},

		// Core rules configuration
		rules: {
			// Turn on ESLint's built-in recommended checks
			"no-undef": "error", // error on using undefined variables
			"no-unused-vars": "warn", // warn on variables declared but not used
			"no-console": "off", // allow console.* in this prototype
			eqeqeq: "error", // require === and !==
			curly: "error", // require curly braces for all control statements
		},
	},
];
