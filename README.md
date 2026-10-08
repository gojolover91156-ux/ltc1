# LTC Personal Manager — User Install + Railway

Private, read-only Litecoin Discord app.

## Commands

- `/balance`
- `/history`
- `/address`
- `/refresh`
- `/status`

Commands work as global application commands. They are restricted to `OWNER_ID`.

## Railway

Connect this GitHub repository to Railway. Railway detects `package.json` and runs `npm start`.

Required variables:

```env
DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN
CLIENT_ID=YOUR_DISCORD_APPLICATION_ID
OWNER_ID=YOUR_DISCORD_USER_ID
LTC_ADDRESS=LfTAT8gjC6Gg6B5XyDqpfuiCCyvz9ioC48
```

Optional:

```env
ALERT_CHANNEL_ID=YOUR_CHANNEL_ID
CHECK_INTERVAL=30
```

No `GUILD_ID` is required.

## Discord Developer Portal — User Install

Open **Developer Portal → Your Application → Installation**.

1. Enable **User Install**.
2. In the installation contexts/options, enable the user/account installation context.
3. Under **Default Install Settings / Scopes**, enable:
   - `applications.commands`
4. If you also want server installation, keep **Guild Install** enabled and configure the `bot` scope for the guild installation.
5. Save the changes.
6. Use the generated **Install Link** to install the app to your Discord account. Choose the account/user installation option when Discord shows it.

Discord's user-installed apps can be used by that user across DMs, group DMs and servers. The app does not need to be added as a bot member to every server just for user-installed slash commands.

### Important

User Install controls **where the app can be used**.

`OWNER_ID` controls **who can use this wallet manager**.

Therefore, even if another user installs the app, the wallet commands will reject them unless their Discord user ID matches `OWNER_ID`.

## Bot Token

The Railway process still connects to Discord using the bot token, so create the Bot user under **Developer Portal → Bot** and put its token in `DISCORD_TOKEN`.

Never publish the token.

## Client ID

Copy the Application ID from **General Information** into `CLIENT_ID`.

## Owner ID

Copy your Discord user ID into `OWNER_ID`.

## Security

This manager is read-only. It never needs a Litecoin private key, seed phrase, WIF or wallet password.

Only the public Litecoin address is monitored.

## GitHub auto-deploy

Once the Railway service is connected to GitHub, pushes to the configured branch can automatically trigger new deployments when Railway's auto-deploy setting is enabled.
