# Twilio Conversations Troubleshooting & Configuration Checks

If you are not seeing incoming Twilio texts in the `ingress-egress` service despite the service being in `CONNECTED` state, please verify the following configurations in your Twilio Console.

## 1. Bot Participation in Conversations
The `TwilioIngressClient` uses the `@twilio/conversations` SDK, which operates via WebSockets. It only receives `messageAdded` events for conversations where the configured `TWILIO_IDENTITY` is an active participant.

- **Check**: Go to a specific Conversation in the Twilio Console and look at the **Participants** tab.
- **Ensure**: The identity matching your `TWILIO_IDENTITY` environment variable (e.g., `ChaCha`) must be listed as a participant.
- **Note**: If a conversation is created automatically via an incoming SMS, the bot identity might not be added by default unless you have configured a webhook or a "Conversation Scoped" handler to do so.

## 2. SMS/WhatsApp to Conversation Mapping
Ensure your Twilio Phone Number is correctly mapped to the Conversations Service.

- **Path**: **Develop > Phone Numbers > Manage > Active Numbers**
- **Section**: **Messaging**
- **Configure with**: Select **Conversations**.
- **Conversation Service**: Select the service matching your `TWILIO_CHAT_SERVICE_SID`.

## 3. Conversation Service Webhooks (Conflicts)
While the SDK uses WebSockets, backend webhooks can sometimes interfere or give clues.

- **Path**: **Conversations > Services > [Your Service] > Webhooks**
- **Post-event Webhooks**: If you have `onMessageAdded` or `onConversationAdded` configured to an external URL, ensure they are not failing or stripping data.
- **Pre-event Webhooks**: Ensure no "Pre-event" webhooks are rejecting the messages.

## 4. Reachability Indicators
Enabling reachability indicators can help diagnose if the SDK client is truly seen as "online" by Twilio.

- **Path**: **Conversations > Services > [Your Service] > Configuration**
- **Reachability**: Enable "Reachability indicators".

## 5. API Key Scopes
Ensure the API Key used (`TWILIO_API_KEY`) has sufficient permissions.

- **Note**: Standard API keys usually suffice for Conversations.

## 6. Diagnostic Endpoint
Use the new debug endpoint in the BitBrat platform to see exactly what the bot sees:

- **URL**: `https://[your-service-url]/_debug/twilio`
- **What to look for**:
    - `state`: Should be `CONNECTED`.
    - `identity`: Should match your expected bot name.
    - `conversations`: A list of Conversations the bot is currently subscribed to. If this list is empty, the bot will not receive any messages.

## 7. Common Pitfall: SMS Auto-creation
By default, Twilio Conversations can be set to auto-create a conversation when an SMS is received. However, it doesn't automatically know which "Identity" (your bot) should be added to that conversation. 

You may need a small Twilio Function or a Webhook that listens for `onConversationAdded` (at the Service level) and adds your `TWILIO_IDENTITY` as a participant if it's not already there.
