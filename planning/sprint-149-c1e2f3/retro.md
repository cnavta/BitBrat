# Sprint Retro – sprint-149-c1e2f3

## What worked well
- The cycle detection using `WeakSet` was easy to implement and effectively stopped the infinite recursion.
- Adding a depth limit provides an extra layer of protection against very large objects that aren't necessarily circular but still memory-intensive.
- Using a reproduction test first made it easy to verify the fix.

## What didn't work well
- I accidentally committed `.output.txt`, but I fixed it with a force push.
- It was slightly confusing that the problematic log line was not in `main`, but I followed the recommendation to ensure safe logging is used.

## Conclusion
Sprint successful. Logger is now much more robust.
