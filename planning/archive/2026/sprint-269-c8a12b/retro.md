# Retro – sprint-269-c8a12b

## What Worked
- Identified the root cause (Firestore path segment count) quickly from the error message.
- Implementation and testing were straightforward once the path structure was corrected.

## What Didn't Work
- Initial path design in V2 store assumed a nested structure that Firestore doesn't support as a direct document reference without specific sub-collection handling.

# Key Learnings – sprint-269-c8a12b
- Always ensure Firestore document paths have an even number of segments when using \`db.doc(path)\`.
- Using a delimiter (like \`_\`) to combine multiple identifiers into a single document ID is a common and effective pattern for flattening Firestore structures.
