require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  ownerId: process.env.OWNER_ID,
  address: process.env.LTC_ADDRESS,
  alertChannelId: process.env.ALERT_CHANNEL_ID || "",
  checkInterval: Math.max(15, Number(process.env.CHECK_INTERVAL || 30))
};

if (!CONFIG.token || !CONFIG.clientId || !CONFIG.ownerId) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID or OWNER_ID in Railway Variables");
  process.exit(1);
}

if (!CONFIG.address) {
  console.error("Missing LTC_ADDRESS in .env");
  process.exit(1);
}

const API_BASE = "https://api.blockcypher.com/v1/ltc/main";
const PRICE_API = "https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd,eur";
const STATE_FILE = path.join(__dirname, "wallet-state.json");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Show your current Litecoin wallet balance"),

  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show recent Litecoin wallet transactions")
    .addIntegerOption(option =>
      option
        .setName("count")
        .setDescription("Number of transactions to show (1-10)")
        .setMinValue(1)
        .setMaxValue(10)
    ),

  new SlashCommandBuilder()
    .setName("address")
    .setDescription("Show your tracked Litecoin address"),

  new SlashCommandBuilder()
    .setName("refresh")
    .setDescription("Refresh wallet data now"),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show wallet monitoring status")
].map(command => command.toJSON());

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {
      initialized: false,
      knownTransactions: []
    };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let state = loadState();

function isOwner(interaction) {
  return interaction.user.id === CONFIG.ownerId;
}

function litoshiToLtc(value) {
  return Number(value || 0) / 100000000;
}

function fmtLtc(value) {
  return `${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 8,
    maximumFractionDigits: 8
  })} LTC`;
}

function fmtMoney(value, currency) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "N/A";
  const symbol = currency === "EUR" ? "€" : "$";
  return `${symbol}${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ${currency}`;
}


function walletAddressUrl() {
  return `https://litecoinspace.org/address/${CONFIG.address}`;
}

function moneyPair(ltcAmount, price) {
  const usd = price.usd !== null ? ltcAmount * price.usd : null;
  const eur = price.eur !== null ? ltcAmount * price.eur : null;
  return `**${fmtLtc(ltcAmount)}**\n${fmtMoney(usd, "USD")} • ${fmtMoney(eur, "EUR")}`;
}

function explorerAddressLink() {
  return `[${CONFIG.address}](https://litecoinspace.org/address/${CONFIG.address})`;
}

function statusBadge(online = true) {
  return online ? "🟢 **ONLINE**" : "🔴 **OFFLINE**";
}

async function fetchLtcPrice() {
  try {
    const response = await fetch(PRICE_API);
    if (!response.ok) throw new Error(`Price API HTTP ${response.status}`);
    const data = await response.json();
    return {
      usd: Number(data?.litecoin?.usd) || null,
      eur: Number(data?.litecoin?.eur) || null
    };
  } catch (error) {
    console.error("Price lookup error:", error.message);
    return { usd: null, eur: null };
  }
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function explorerUrl(hash) {
  return `https://litecoinspace.org/tx/${hash}`;
}

async function fetchWallet() {
  const url = `${API_BASE}/addrs/${encodeURIComponent(CONFIG.address)}?limit=10`;
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`BlockCypher HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

async function fetchTransaction(hash) {
  const response = await fetch(`${API_BASE}/txs/${hash}`);

  if (!response.ok) {
    throw new Error(`Transaction lookup failed: HTTP ${response.status}`);
  }

  return response.json();
}

function getTxRefs(wallet) {
  return [
    ...(wallet.unconfirmed_txrefs || []),
    ...(wallet.txrefs || [])
  ];
}

function classifyRef(ref) {
  // BlockCypher's address endpoint marks an address's input/output
  // with tx_input_n / tx_output_n.
  if (Number(ref.tx_input_n) >= 0 && Number(ref.tx_output_n) < 0) {
    return "sent";
  }

  if (Number(ref.tx_output_n) >= 0 && Number(ref.tx_input_n) < 0) {
    return "received";
  }

  // Fallback for unusual/self-transfer records.
  if (Number(ref.tx_output_n) >= 0) return "received";
  if (Number(ref.tx_input_n) >= 0) return "sent";

  return "unknown";
}

async function buildBalanceEmbed(wallet) {
  const confirmed = litoshiToLtc(wallet.final_balance);
  const unconfirmed = litoshiToLtc(wallet.unconfirmed_balance);
  const totalReceived = litoshiToLtc(wallet.total_received);
  const totalSent = litoshiToLtc(wallet.total_sent);
  const txCount = wallet.final_n_tx ?? wallet.n_tx ?? 0;
  const price = await fetchLtcPrice();

  const usdValue = price.usd !== null ? confirmed * price.usd : null;
  const eurValue = price.eur !== null ? confirmed * price.eur : null;

  return new EmbedBuilder()
    .setColor(0xB8FF4A)
    .setAuthor({
      name: "LTC • PERSONAL WALLET",
      iconURL: "https://cryptologos.cc/logos/litecoin-ltc-logo.png?v=040"
    })
    .setTitle("💎 Wallet Overview")
    .setDescription(
      `> **Litecoin Mainnet** · Read-only portfolio monitor\n` +
      `> ${explorerAddressLink()}`
    )
    .addFields(
      {
        name: "💰 TOTAL BALANCE",
        value:
          `### ${fmtLtc(confirmed)}\n` +
          `**${fmtMoney(usdValue, "USD")}**  ·  **${fmtMoney(eurValue, "EUR")}**`,
        inline: false
      },
      {
        name: "📥 RECEIVED",
        value: moneyPair(totalReceived, price),
        inline: true
      },
      {
        name: "📤 SENT",
        value: moneyPair(totalSent, price),
        inline: true
      },
      {
        name: "⛓️ TRANSACTIONS",
        value: `**${Number(txCount).toLocaleString()}**\nconfirmed`,
        inline: true
      },
      {
        name: "⏳ UNCONFIRMED",
        value: moneyPair(unconfirmed, price),
        inline: true
      },
      {
        name: "📈 LTC PRICE",
        value:
          price.usd !== null
            ? `**${fmtMoney(price.usd, "USD")}**\n**${fmtMoney(price.eur, "EUR")}**`
            : "Price unavailable",
        inline: true
      },
      {
        name: "🛡️ SECURITY",
        value: "🔒 Read-only\nNo private keys stored",
        inline: true
      }
    )
    .addFields({
      name: "📍 TRACKED ADDRESS",
      value: `\`${CONFIG.address}\``,
      inline: false
    })
    .setFooter({
      text: "LTC Personal Manager • Live blockchain data"
    })
    .setTimestamp();
}

function balanceButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("refresh_balance")
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("↻"),
    new ButtonBuilder()
      .setLabel("Explorer")
      .setStyle(ButtonStyle.Link)
      .setURL(walletAddressUrl())
      .setEmoji("↗")
  );
}

async function sendNewTransactionAlert(ref) {
  if (!CONFIG.alertChannelId) return;

  const channel = await client.channels.fetch(CONFIG.alertChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const type = classifyRef(ref);
  const amount = litoshiToLtc(ref.value);
  const price = await fetchLtcPrice();

  const usd = price.usd !== null ? amount * price.usd : null;
  const eur = price.eur !== null ? amount * price.eur : null;

  const received = type === "received";
  const sent = type === "sent";

  const embed = new EmbedBuilder()
    .setColor(received ? 0x57F287 : sent ? 0xED4245 : 0xB8FF4A)
    .setAuthor({
      name: received ? "LTC • INCOMING PAYMENT" : sent ? "LTC • OUTGOING PAYMENT" : "LTC • TRANSACTION"
    })
    .setTitle(received ? "📥 Litecoin Received" : sent ? "📤 Litecoin Sent" : "⛓️ Litecoin Transaction")
    .setDescription(
      `**${received ? "+" : sent ? "-" : ""}${fmtLtc(amount)}**\n` +
      `${fmtMoney(usd, "USD")} · ${fmtMoney(eur, "EUR")}`
    )
    .addFields(
      {
        name: "STATUS",
        value: Number(ref.confirmations || 0) > 0 ? "🟢 Confirmed" : "🟡 Unconfirmed",
        inline: true
      },
      {
        name: "CONFIRMATIONS",
        value: `**${Number(ref.confirmations || 0)}**`,
        inline: true
      },
      {
        name: "TRANSACTION",
        value: `[${shortHash(ref.tx_hash)}](${explorerUrl(ref.tx_hash)})`,
        inline: true
      }
    )
    .setFooter({ text: "LTC Personal Manager • Live blockchain alert" })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(console.error);
}

async function monitorWallet() {
  try {
    const wallet = await fetchWallet();
    const refs = getTxRefs(wallet);

    const currentHashes = [...new Set(refs.map(r => r.tx_hash).filter(Boolean))];

    if (!state.initialized) {
      state.initialized = true;
      state.knownTransactions = currentHashes.slice(0, 100);
      saveState(state);
      console.log(`Wallet initialized. ${currentHashes.length} transaction(s) currently visible.`);
      return wallet;
    }

    const newRefs = refs.filter(ref => !state.knownTransactions.includes(ref.tx_hash));

    for (const ref of newRefs) {
      await sendNewTransactionAlert(ref);
    }

    state.knownTransactions = [
      ...new Set([...currentHashes, ...state.knownTransactions])
    ].slice(0, 100);

    saveState(state);
    return wallet;
  } catch (error) {
    console.error("Wallet monitor error:", error.message);
    return null;
  }
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(CONFIG.token);

  // Global commands work in DMs as well as servers.
  // Discord can take a little while to propagate global commands.
  await rest.put(
    Routes.applicationCommands(CONFIG.clientId),
    { body: commands }
  );

  console.log("Global slash commands registered (server + DMs).");
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Tracking LTC address: ${CONFIG.address}`);
  console.log(`Checking every ${CONFIG.checkInterval}s`);

  await registerCommands().catch(error => {
    console.error("Command registration failed:", error.message);
  });

  await monitorWallet();
  setInterval(monitorWallet, CONFIG.checkInterval * 1000);
});

client.on("interactionCreate", async interaction => {
  if (interaction.isButton()) {
    if (interaction.customId !== "refresh_balance") return;

    if (!isOwner(interaction)) {
      return interaction.reply({
        content: "You are not authorized to use this wallet manager.",
        ephemeral: true
      });
    }

    try {
      await interaction.deferUpdate();
      const wallet = await fetchWallet();

      await interaction.editReply({
        content: " ",
        embeds: [await buildBalanceEmbed(wallet)],
        components: [balanceButtons()]
      });
    } catch (error) {
      console.error("Refresh button error:", error);
      await interaction.followUp({
        content: `Could not refresh the wallet: ${error.message}`,
        ephemeral: true
      }).catch(() => {});
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (!isOwner(interaction)) {
    return interaction.reply({
      content: "You are not authorized to use this personal wallet manager.",
      ephemeral: true
    });
  }

  try {
    if (interaction.commandName === "balance") {
      await interaction.deferReply({ ephemeral: true });
      const wallet = await fetchWallet();
      return interaction.editReply({
        embeds: [await buildBalanceEmbed(wallet)],
        components: [balanceButtons()]
      });
    }

    if (interaction.commandName === "address") {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xB8FF4A)
            .setAuthor({ name: "LTC • WALLET ADDRESS" })
            .setTitle("📍 Receive Address")
            .setDescription(
              `Send Litecoin to the address below.\n\n` +
              `> \`${CONFIG.address}\``
            )
            .addFields({
              name: "NETWORK",
              value: "🟢 Litecoin Mainnet",
              inline: true
            }, {
              name: "ACCESS",
              value: "🔒 Read-only monitor",
              inline: true
            })
            .setFooter({ text: "LTC Personal Manager" })
            .setTimestamp()
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel("Open Explorer")
              .setStyle(ButtonStyle.Link)
              .setURL(walletAddressUrl())
              .setEmoji("↗")
          )
        ],
        ephemeral: true
      });
    }

    if (interaction.commandName === "refresh") {
      await interaction.deferReply({ ephemeral: true });
      const wallet = await monitorWallet();

      if (!wallet) {
        return interaction.editReply("Could not refresh the wallet right now.");
      }

      return interaction.editReply({
        content: "Wallet refreshed.",
        embeds: [await buildBalanceEmbed(wallet)],
        components: [balanceButtons()]
      });
    }

    if (interaction.commandName === "status") {
      const wallet = await fetchWallet();

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setAuthor({ name: "LTC • SYSTEM STATUS" })
            .setTitle("⚡ Monitor Status")
            .setDescription("Your personal Litecoin monitor is running normally.")
            .addFields(
              { name: "BOT", value: "🟢 **ONLINE**", inline: true },
              { name: "BLOCKCHAIN", value: "🟢 **CONNECTED**", inline: true },
              { name: "MONITOR", value: `Every **${CONFIG.checkInterval}s**`, inline: true },
              { name: "KNOWN TXs", value: `**${state.knownTransactions.length}**`, inline: true },
              { name: "WALLET TXs", value: `**${wallet.final_n_tx ?? wallet.n_tx ?? 0}**`, inline: true },
              { name: "MODE", value: "🔒 Read-only", inline: true }
            )
            .setFooter({ text: "LTC Personal Manager • System diagnostics" })
            .setTimestamp()
        ],
        ephemeral: true
      });
    }

    if (interaction.commandName === "history") {
      await interaction.deferReply({ ephemeral: true });

      const count = interaction.options.getInteger("count") || 5;
      const wallet = await fetchWallet();
      const refs = getTxRefs(wallet);

      const seen = new Set();
      const unique = [];

      for (const ref of refs) {
        if (!ref.tx_hash || seen.has(ref.tx_hash)) continue;
        seen.add(ref.tx_hash);
        unique.push(ref);
        if (unique.length >= count) break;
      }

      if (!unique.length) {
        return interaction.editReply("No transactions found for this address.");
      }

      const lines = unique.map((ref, i) => {
        const type = classifyRef(ref);
        const amount = litoshiToLtc(ref.value);
        const sign = type === "received" ? "+" : type === "sent" ? "-" : "";
        const status = Number(ref.confirmations || 0) > 0
          ? `${ref.confirmations} conf.`
          : "unconfirmed";

        return `**${i + 1}. ${type.toUpperCase()}** ${sign}${fmtLtc(amount)} — ${status}\n` +
               `[${shortHash(ref.tx_hash)}](${explorerUrl(ref.tx_hash)})`;
      });

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xB8FF4A)
            .setAuthor({ name: "LTC • TRANSACTION HISTORY" })
            .setTitle("📜 Recent Activity")
            .setDescription(
              `Your latest **${unique.length}** Litecoin transaction(s).\n\n` +
              lines.join("\n\n")
            )
            .addFields({
              name: "WALLET",
              value: explorerAddressLink(),
              inline: false
            })
            .setFooter({ text: "LTC Personal Manager • Litecoin Mainnet" })
            .setTimestamp()
        ]
      });
    }
  } catch (error) {
    console.error(error);

    const message = `Error: ${error.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

client.login(CONFIG.token);
