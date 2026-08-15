#!/bin/bash
#
# DM Detection Diagnostic Script
# Sprint 13: Debug DM event detection issues
#
# Usage: ./tools/debug-dm-detection.sh [platform]
# Example: ./tools/debug-dm-detection.sh discord
#

PLATFORM="${1:-all}"

echo "=== DM Detection Diagnostic ==="
echo "Platform: $PLATFORM"
echo

# Check YAML configs exist
echo "--- YAML Config Files ---"
if [ "$PLATFORM" = "all" ] || [ "$PLATFORM" = "discord" ]; then
  if [ -f "config/platforms/discord/dm-message.v1.yaml" ]; then
    echo "✅ Discord DM config exists"
    echo "   Priority: $(grep 'priority:' config/platforms/discord/dm-message.v1.yaml | awk '{print $2}')"
    echo "   Filter: $(grep -A2 'filter:' config/platforms/discord/dm-message.v1.yaml | tail -1 | xargs)"
  else
    echo "❌ Discord DM config MISSING"
  fi
fi

if [ "$PLATFORM" = "all" ] || [ "$PLATFORM" = "slack" ]; then
  if [ -f "config/platforms/slack/dm-message.v1.yaml" ]; then
    echo "✅ Slack DM config exists"
    echo "   Priority: $(grep 'priority:' config/platforms/slack/dm-message.v1.yaml | awk '{print $2}')"
  else
    echo "❌ Slack DM config MISSING"
  fi
fi

if [ "$PLATFORM" = "all" ] || [ "$PLATFORM" = "twitch" ]; then
  if [ -f "config/platforms/twitch/dm-message.v1.yaml" ]; then
    echo "✅ Twitch DM config exists"
    echo "   Priority: $(grep 'priority:' config/platforms/twitch/dm-message.v1.yaml | awk '{print $2}')"
  else
    echo "❌ Twitch DM config MISSING"
  fi
fi

echo
echo "--- Log Queries for Staging ---"
echo
echo "To check if DM events are being detected, run these in staging logs:"
echo

if [ "$PLATFORM" = "all" ] || [ "$PLATFORM" = "discord" ]; then
  echo "# Discord: Check channel type values"
  echo "grep 'discord.message.received' | jq '.channelType'"
  echo
  echo "# Discord: Check if DMs are detected"
  echo "grep 'dm.message.v1' | jq '.internalEventType'"
  echo
  echo "# Discord: Check what envelope builder produces"
  echo "grep 'discord.message.published' | jq '{correlationId, channelId}'"
  echo
fi

if [ "$PLATFORM" = "all" ] || [ "$PLATFORM" = "slack" ]; then
  echo "# Slack: Check DM detection"
  echo "grep 'slack.message.received' | jq '.channel_type'"
  echo
fi

if [ "$PLATFORM" = "all" ] || [ "$PLATFORM" = "twitch" ]; then
  echo "# Twitch: Check whisper events"
  echo "grep 'whisper' | jq '.'"
  echo
fi

echo
echo "--- Quick Test Commands ---"
echo
echo "# Test Discord DM detection locally"
echo "npm run brat -- integration test discord --event dm-message.v1 --fixture ./test/fixtures/dm-events/discord-dm.json"
echo
echo "# Check if feature flags are enabled"
echo "echo \"ENABLE_CONFIG_REGISTRY=\$ENABLE_CONFIG_REGISTRY\""
echo "echo \"ENABLE_GENERIC_BUILDER=\$ENABLE_GENERIC_BUILDER\""
echo

echo "--- Expected Discord channel.type Values ---"
echo "According to Discord.js v14:"
echo "  GuildText: 0"
echo "  DM: 1"
echo "  GuildVoice: 2"
echo "  GroupDM: 3"
echo
echo "If you're seeing a different value, the Discord.js version might have changed."
echo "Check: https://discord-api-types.dev/api/discord-api-types-v10/enum/ChannelType"
echo

echo "=== Next Steps ==="
echo "1. Check staging logs for 'discord.message.received' to see channelType value"
echo "2. Verify channelType === 1 for DM messages"
echo "3. If channelType is different, update filter in config/platforms/discord/dm-message.v1.yaml"
echo "4. For Twitch: Check if whisper events are being received at all"
