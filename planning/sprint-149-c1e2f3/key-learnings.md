# Key Learnings – sprint-149-c1e2f3

- **Cycle Detection is Mandatory for Recursive Object Traversal:** When writing utilities that traverse arbitrary objects (like loggers, serializers, or deep cloners), always implement cycle detection using `WeakSet` or similar to prevent infinite recursion.
- **Impose Depth Limits:** Even without cycles, deep objects can cause stack overflows or consume excessive memory. A sensible default depth limit (e.g., 10) is a good safety measure.
- **Avoid Logging SDK Internals:** Library-provided objects (like Firestore Snapshots or Client instances) often contain complex internal state, private fields, or circular references. It is safer and more efficient to log only the specific data needed (e.g., `snap.data()` or `snap.exists`) rather than the entire object.
