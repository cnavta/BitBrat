# Recommendations for your new TypeScript project

Here are a few recommendations to improve your project setup:

### 1. Specify Node.js version

Create a `.nvmrc` file in the root of your project to specify the version of Node.js to use. This ensures that everyone working on the project uses the same Node.js version.

**.nvmrc**
```
20
```

### 2. Add Prettier for code formatting

[Prettier](https://prettier.io/) is an opinionated code formatter that helps maintain a consistent code style across your project. 

First, install Prettier:

```bash
npm install --save-dev prettier eslint-config-prettier
```

Then, create a `.prettierrc.js` file:

**.prettierrc.js**
```javascript
module.exports = {
  semi: true,
  trailingComma: 'all',
  singleQuote: true,
  printWidth: 120,
  tabWidth: 2,
};
```

Finally, update your `.eslintrc.js` to integrate Prettier:

**.eslintrc.js**
```javascript
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier' // Add this
  ],
};
```

### 3. Enforce linting before commits

Use [husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/okonet/lint-staged) to automatically lint your staged files before you commit. This helps to catch errors early and maintain code quality.

Install the dependencies:

```bash
npm install --save-dev husky lint-staged
```

Then, initialize husky:

```bash
npx husky init
```

This will create a `.husky` directory in your project. Now, create a `pre-commit` hook:

**.husky/pre-commit**
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npx lint-staged
```

Finally, add the `lint-staged` configuration to your `package.json`:

**package.json**
```json
{
  "lint-staged": {
    "*.ts": "eslint --cache --fix"
  }
}
```

### 4. Use tsconfig-paths for module aliasing

For cleaner imports, you can use [tsconfig-paths](https://www.npmjs.com/package/tsconfig-paths) to create aliases for your module paths. This is especially useful in larger projects.

First, install the package:

```bash
npm install --save-dev tsconfig-paths
```

Then, update your `tsconfig.json` with your desired aliases:

**tsconfig.json**
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

Now you can import modules using the `@` alias, like this:

```typescript
import { MyComponent } from '@/components/MyComponent';
```
