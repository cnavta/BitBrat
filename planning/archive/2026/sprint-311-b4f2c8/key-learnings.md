# Key Learnings - sprint-311-b4f2c8

- **JsonLogic in Firestore**: In this project, `logic` properties containing JsonLogic should be stored as serialized JSON strings to ensure consistent behavior across services and simplify loader validation.
- **Schema Alignment**: Population scripts (like `setup`) must be kept in sync with the data models defined in the service loaders.
