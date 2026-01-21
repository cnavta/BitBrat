# Retro – sprint-205-d8f1a2

## What Worked
- Porting logic to TypeScript was straightforward and allowed for better type safety (though some `any` casts were needed for raw architecture access).
- Integrating into the existing `brat` tool structure was clean.
- The `validate_deliverable.sh` script effectively caught template compilation errors early.

## What Didn't
- Architecture interpolation initially blocked the bootstrap command because of unresolved variables in unrelated parts of `architecture.yaml`. Setting `BITBRAT_INTERPOLATION=0` fixed this.
- `BaseServer.start` and `BaseServer.close` had mandatory arguments that the initial template missed, causing compilation errors in generated services.

## Next Steps
- Consider formalizing `BITBRAT_INTERPOLATION=0` for all non-deployment `brat` commands.
- Alias `npm run bootstrap:service` to `npm run brat -- service bootstrap` in `package.json` in a future refactor.
