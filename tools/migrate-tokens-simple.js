const { getFirestore } = require('/workspace/dist/common/firebase');
const { createDocumentStore } = require('/workspace/dist/common/persistence/factory');

(async () => {
  console.log('Starting token migration...');
  const firestore = getFirestore();
  const pgStore = createDocumentStore();

  const paths = [
    { fs: 'oauth/twitch/bot/token', pg: 'twitch:bot' },
    { fs: 'oauth/twitch/broadcaster/token', pg: 'twitch:broadcaster' },
    { fs: 'oauth/discord/broadcaster/token', pg: 'discord:broadcaster' }
  ];

  for (const { fs, pg } of paths) {
    console.log(`Migrating ${fs} -> ${pg}...`);
    try {
      const docSnap = await firestore.doc(fs).get();
      if (!docSnap.exists) {
        console.log(`  No token at ${fs}, skipping`);
        continue;
      }
      const tokenData = docSnap.data();
      if (!tokenData.accessToken) {
        console.log(`  Token missing accessToken, skipping`);
        continue;
      }
      await pgStore.set('twitch_tokens', pg, {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken || null,
        scope: tokenData.scope || [],
        expiresIn: tokenData.expiresIn || null,
        obtainmentTimestamp: tokenData.obtainmentTimestamp || null,
        userId: tokenData.userId || null,
        updatedAt: tokenData.updatedAt || Date.now(),
      });
      console.log(`  ✅ Migrated ${pg}`);
    } catch (error) {
      console.error(`  ❌ Failed:`, error.message);
    }
  }
  console.log('✅ Migration complete!');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
