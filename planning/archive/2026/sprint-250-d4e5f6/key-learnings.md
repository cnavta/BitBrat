# Key Learnings – sprint-250-d4e5f6

- When updating a service to use a new export from a dependency, ensure that all test mocks for that dependency are also updated.
- Jest mocks need to accurately reflect the structure of the module being imported, especially when using named exports that return functions.
