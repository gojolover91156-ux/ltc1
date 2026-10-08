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
  ButtonStyle,
} = require("discord.js");

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  ownerId: process.env.OWNER_ID,
  ltcAddress:
    process.env.LTC_ADDRESS ||
    "LfTAT8gjC6Gg6B5XyDqpfuiCCyvz9ioC48",
  alertChannelId: process.env.ALERT_CHANNEL_ID || "",
  checkInterval: Math.max(
    Number(process.env.CHECK_INTERVAL || 30),
    15
  ),
};

if (!CONFIG.token || !CONFIG.clientId || !CONFIG.ownerId) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID or OWNER_ID.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const BLOCKCYPHER_API =
  "https://api.blockcypher.com/v1/ltc/main";

const COINGECKO_API =
  "https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd,eur";

let previousTxHashes = new Set();

const commands = [
  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("View the SNACHZ LTC wallet balance."),

  new SlashCommandBuilder()
    .setName("history")
    .setDescription("View recent SNACHZ LTC transactions.")
    .addIntegerOption((option) =>
      option
        .setName("count")
        .setDescription("Number of transactions to show.")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    ),

  new SlashCommandBuilder()
    .setName("address")
    .setDescription("Show the tracked LTC address."),

  new SlashCommandBuilder()
    .setName("refresh")
    .setDescription("Refresh wallet information."),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show SNACHZ LTC manager status."),
].map((command) => command.toJSON());

function isOwner(interaction) {
  return interaction.user.id === CONFIG.ownerId;
}

function litoshiToLtc(value) {
  return Number(value || 0) / 100000000;
}

function fmtLtc(value) {
  return `${Number(value || 0).toFixed(8)} LTC`;
}

function fmtMoney(value, currency) {
  const symbol = currency === "USD" ? "$" : "€";

  return `${symbol}${Number(value || 0).toLocaleString(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  )}`;
}

function walletAddressUrl() {
  return `https://litecoinspace.org/address/${CONFIG.ltcAddress}`;
}

function txUrl(hash) {
  return `https://litecoinspace.org/tx/${hash}`;
}

async function fetchWallet() {
  const response = await fetch(
    `${BLOCKCYPHER_API}/addrs/${CONFIG.ltcAddress}/full?limit=50`
  );

  if (!response.ok) {
    throw new Error(
      `BlockCypher error: ${response.status}`
    );
  }

  return response.json();
}

async function fetchLtcPrice() {
  try {
    const response = await fetch(COINGECKO_API);

    if (!response.ok) {
      return {
        usd: 0,
        eur: 0,
      };
    }

    const data = await response.json();

    return {
      usd: Number(data?.litecoin?.usd || 0),
      eur: Number(data?.litecoin?.eur || 0),
    };
  } catch {
    return {
      usd: 0,
      eur: 0,
    };
  }
}

function moneyPair(ltc, prices) {
  const usd =
    prices.usd > 0
      ? fmtMoney(ltc * prices.usd, "USD")
      : "$—";

  const eur =
    prices.eur > 0
      ? fmtMoney(ltc * prices.eur, "EUR")
      : "€—";

  return `${usd} • ${eur}`;
}

function securityText() {
  return [
    "🔒 **READ-ONLY**",
    "No private key stored",
    "No seed phrase required",
    "Public address tracking only",
  ].join("\n");
}

async function createBalanceEmbed() {
  const wallet = await fetchWallet();
  const prices = await fetchLtcPrice();

  const balance = litoshiToLtc(wallet.balance);
  const totalReceived = litoshiToLtc(wallet.total_received);
  const totalSent = litoshiToLtc(wallet.total_sent);

  const unconfirmed = litoshiToLtc(
    wallet.unconfirmed_balance
  );

  const confirmedUsd = balance * prices.usd;
  const confirmedEur = balance * prices.eur;

  const embed = new EmbedBuilder()
    .setColor(0xb8ff4a)
    .setAuthor({
      name: "SNACHZ LTC • PERSONAL WALLET",
    })
    .setTitle("✦  WALLET DASHBOARD")
    .setDescription(
      [
        "```ansi",
        "\u001b[1;32mSNACHZ LTC\u001b[0m",
        "\u001b[2;37mLIVE WALLET MANAGEMENT SYSTEM\u001b[0m",
        "```",
        `> **Tracked wallet:** [${CONFIG.ltcAddress.slice(
          0,
          8
        )}...${CONFIG.ltcAddress.slice(-8)}](${walletAddressUrl()})`,
        "",
        "### ◈ PORTFOLIO VALUE",
        `**${fmtLtc(balance)}**`,
        `**${fmtMoney(confirmedUsd, "USD")}**  •  **${fmtMoney(
          confirmedEur,
          "EUR"
        )}**`,
      ].join("\n")
    )
    .addFields(
      {
        name: "▸ PORTFOLIO",
        value: [
          `**LTC**  ${fmtLtc(balance)}`,
          `**USD**  ${fmtMoney(confirmedUsd, "USD")}`,
          `**EUR**  ${fmtMoney(confirmedEur, "EUR")}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "▸ ACTIVITY",
        value: [
          `Received: **${fmtLtc(totalReceived)}**`,
          `Sent: **${fmtLtc(totalSent)}**`,
          `Pending: **${fmtLtc(unconfirmed)}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "▸ NETWORK",
        value: [
          `Transactions: **${wallet.n_tx || 0}**`,
          `Unconfirmed: **${wallet.unconfirmed_n_tx || 0}**`,
          "Network: **Litecoin Mainnet**",
        ].join("\n"),
        inline: true,
      },
      {
        name: "▸ MARKET",
        value: [
          `LTC/USD: **$${prices.usd.toLocaleString(
            "en-US",
            {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }
          )}**`,
          `LTC/EUR: **€${prices.eur.toLocaleString(
            "en-US",
            {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }
          )}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "▸ SECURITY",
        value: securityText(),
        inline: true,
      },
      {
        name: "▸ MONITOR",
        value: [
          "Status: **ONLINE**",
          `Interval: **${CONFIG.checkInterval}s**`,
          "Blockchain: **LIVE**",
        ].join("\n"),
        inline: true,
      },
      {
        name: "▸ TRACKED WALLET",
        value: [
          `\`${CONFIG.ltcAddress}\``,
          `[Open in LitecoinSpace](${walletAddressUrl()})`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({
      text: "SNACHZ LTC • Personal Wallet Manager • Live blockchain data",
    })
    .setTimestamp();

  return embed;
}

function balanceButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("refresh_balance")
      .setLabel("Refresh")
      .setEmoji("↻")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setLabel("Explorer")
      .setEmoji("↗")
      .setStyle(ButtonStyle.Link)
      .setURL(walletAddressUrl())
  );
}

async function createHistoryEmbed(count = 5) {
  const wallet = await fetchWallet();
  const prices = await fetchLtcPrice();

  const txs = wallet.txs || [];

  const embed = new EmbedBuilder()
    .setColor(0xb8ff4a)
    .setAuthor({
      name: "SNACHZ LTC • TRANSACTION HISTORY",
    })
    .setTitle("✦  RECENT ACTIVITY")
    .setDescription(
      [
        `Showing the latest **${Math.min(
          count,
          txs.length
        )}** transactions.`,
        "",
        `Market conversion: **1 LTC ≈ $${prices.usd.toFixed(
          2
        )} / €${prices.eur.toFixed(2)}**`,
        `[View wallet on LitecoinSpace](${walletAddressUrl()})`,
      ].join("\n")
    );

  if (!txs.length) {
    embed.addFields({
      name: "NO TRANSACTIONS",
      value: "No transactions were returned by the blockchain API.",
    });
  } else {
    for (const tx of txs.slice(0, count)) {
      const received = Number(tx.received || 0);
      const sent = Number(tx.total || 0);

      const inputs = (tx.inputs || []).reduce(
        (sum, input) =>
          sum + Number(input.output_value || 0),
        0
      );

      const outputs = (tx.outputs || []).reduce(
        (sum, output) =>
          sum + Number(output.value || 0),
        0
      );

      const walletInvolved =
        received > 0 || inputs > 0;

      let amount = 0;
      let type = "TRANSACTION";

      if (walletInvolved && outputs > inputs) {
        amount = outputs - inputs;
        type = "RECEIVED";
      } else if (inputs > outputs) {
        amount = inputs - outputs;
        type = "SENT";
      } else {
        amount = litoshiToLtc(
          Math.abs(
            Number(tx.total || 0)
          )
        );
      }

      if (!amount || amount < 0) {
        amount = litoshiToLtc(
          Math.abs(Number(tx.total || 0))
        );
      }

      const confirmations = Number(
        tx.confirmations || 0
      );

      const status =
        confirmations > 0
          ? `Confirmed • ${confirmations} confirmations`
          : "Unconfirmed";

      const usd = amount * prices.usd;
      const eur = amount * prices.eur;

      embed.addFields({
        name: `${type} • ${fmtLtc(amount)}`,
        value: [
          `💵 ${fmtMoney(usd, "USD")} • ${fmtMoney(
            eur,
            "EUR"
          )}`,
          `◈ ${status}`,
          `[View transaction](${txUrl(tx.hash)})`,
        ].join("\n"),
        inline: false,
      });
    }
  }

  embed.setFooter({
    text: "SNACHZ LTC • Litecoin Mainnet • Live blockchain data",
  });

  embed.setTimestamp();

  return embed;
}

async function createStatusEmbed() {
  const wallet = await fetchWallet();

  return new EmbedBuilder()
    .setColor(0xb8ff4a)
    .setAuthor({
      name: "SNACHZ LTC • SYSTEM STATUS",
    })
    .setTitle("✦  MONITOR STATUS")
    .setDescription(
      [
        "```ansi",
        "\u001b[1;32m● ONLINE\u001b[0m",
        "\u001b[2;37mSNACHZ LTC is being managed\u001b[0m",
        "```",
      ].join("\n")
    )
    .addFields(
      {
        name: "BOT",
        value: "🟢 **ONLINE**",
        inline: true,
      },
      {
        name: "BLOCKCHAIN",
        value: "🟢 **CONNECTED**",
        inline: true,
      },
      {
        name: "MONITOR",
        value: `Every **${CONFIG.checkInterval}s**`,
        inline: true,
      },
      {
        name: "WALLET",
        value: "**LTC Mainnet**",
        inline: true,
      },
      {
        name: "KNOWN TX",
        value: `**${previousTxHashes.size}**`,
        inline: true,
      },
      {
        name: "WALLET TX",
        value: `**${wallet.n_tx || 0}**`,
        inline: true,
      },
      {
        name: "MODE",
        value: "🔒 **READ-ONLY**",
        inline: true,
      },
      {
        name: "MANAGING",
        value: "**Snachz LTC**",
        inline: true,
      },
      {
        name: "TRACKED ADDRESS",
        value: `[\`${CONFIG.ltcAddress}\`](${walletAddressUrl()})`,
        inline: false,
      }
    )
    .setFooter({
      text: "SNACHZ LTC • Private Wallet Manager",
    })
    .setTimestamp();
}

async function sendNewTransactionAlert(tx) {
  if (!CONFIG.alertChannelId) return;

  try {
    const channel = await client.channels.fetch(
      CONFIG.alertChannelId
    );

    if (!channel?.isTextBased()) return;

    const prices = await fetchLtcPrice();

    const amount = litoshiToLtc(
      Math.abs(Number(tx.total || 0))
    );

    const embed = new EmbedBuilder()
      .setColor(0xb8ff4a)
      .setAuthor({
        name: "SNACHZ LTC • WALLET ALERT",
      })
      .setTitle("✦  NEW TRANSACTION")
      .setDescription(
        [
          `**${fmtLtc(amount)}**`,
          `${moneyPair(amount, prices)}`,
          "",
          `[View transaction](${txUrl(tx.hash)})`,
        ].join("\n")
      )
      .addFields({
        name: "WALLET",
        value: `[\`${CONFIG.ltcAddress}\`](${walletAddressUrl()})`,
      })
      .setFooter({
        text: "SNACHZ LTC • Live blockchain monitor",
      })
      .setTimestamp();

    await channel.send({
      embeds: [embed],
    });
  } catch (error) {
    console.error(
      "Failed to send transaction alert:",
      error.message
    );
  }
}

async function monitorWallet() {
  try {
    const wallet = await fetchWallet();
    const txs = wallet.txs || [];

    const currentHashes = new Set(
      txs.map((tx) => tx.hash).filter(Boolean)
    );

    if (previousTxHashes.size > 0) {
      for (const tx of txs) {
        if (
          tx.hash &&
          !previousTxHashes.has(tx.hash)
        ) {
          await sendNewTransactionAlert(tx);
        }
      }
    }

    previousTxHashes = currentHashes;
  } catch (error) {
    console.error(
      "Wallet monitor error:",
      error.message
    );
  }
}

async function registerCommands() {
  const rest = new REST({
    version: "10",
  }).setToken(CONFIG.token);

  await rest.put(
    Routes.applicationCommands(CONFIG.clientId),
    {
      body: commands,
    }
  );

  console.log(
    "Global slash commands registered successfully."
  );
}

client.once("ready", async () => {
  console.log(
    `Logged in as ${client.user.tag}`
  );

  try {
    await registerCommands();

    const wallet = await fetchWallet();

    previousTxHashes = new Set(
      (wallet.txs || [])
        .map((tx) => tx.hash)
        .filter(Boolean)
    );

    console.log(
      `Tracking LTC wallet: ${CONFIG.ltcAddress}`
    );

    console.log(
      `Monitor interval: ${CONFIG.checkInterval}s`
    );

    setInterval(
      monitorWallet,
      CONFIG.checkInterval * 1000
    );
  } catch (error) {
    console.error(
      "Startup error:",
      error
    );
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (
      interaction.isButton() &&
      interaction.customId === "refresh_balance"
    ) {
      if (!isOwner(interaction)) {
        return interaction.reply({
          content:
            "You are not authorized to use this wallet manager.",
          ephemeral: true,
        });
      }

      await interaction.deferUpdate();

      const embed = await createBalanceEmbed();

      await interaction.editReply({
        embeds: [embed],
        components: [balanceButtons()],
      });

      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (!isOwner(interaction)) {
      return interaction.reply({
        content:
          "⛔ You are not authorized to use SNACHZ LTC.",
        ephemeral: true,
      });
    }

    if (interaction.commandName === "balance") {
      await interaction.deferReply({
        ephemeral: true,
      });

      const embed = await createBalanceEmbed();

      await interaction.editReply({
        embeds: [embed],
        components: [balanceButtons()],
      });

      return;
    }

    if (interaction.commandName === "history") {
      await interaction.deferReply({
        ephemeral: true,
      });

      const count =
        interaction.options.getInteger("count") ||
        5;

      const embed = await createHistoryEmbed(
        count
      );

      await interaction.editReply({
        embeds: [embed],
      });

      return;
    }

    if (interaction.commandName === "address") {
      const embed = new EmbedBuilder()
        .setColor(0xb8ff4a)
        .setAuthor({
          name: "SNACHZ LTC • WALLET ADDRESS",
        })
        .setTitle("✦  TRACKED ADDRESS")
        .setDescription(
          [
            "```",
            CONFIG.ltcAddress,
            "```",
            `[Open LitecoinSpace Explorer](${walletAddressUrl()})`,
          ].join("\n")
        )
        .setFooter({
          text: "SNACHZ LTC • Read-only wallet manager",
        })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });

      return;
    }

    if (interaction.commandName === "refresh") {
      await interaction.deferReply({
        ephemeral: true,
      });

      const embed = await createBalanceEmbed();

      await interaction.editReply({
        embeds: [embed],
        components: [balanceButtons()],
      });

      return;
    }

    if (interaction.commandName === "status") {
      await interaction.deferReply({
        ephemeral: true,
      });

      const embed = await createStatusEmbed();

      await interaction.editReply({
        embeds: [embed],
      });

      return;
    }
  } catch (error) {
    console.error(
      "Interaction error:",
      error
    );

    const message =
      "Something went wrong while processing the request.";

    if (interaction.deferred) {
      await interaction.editReply({
        content: message,
        embeds: [],
        components: [],
      }).catch(() => {});
    } else if (!interaction.replied) {
      await interaction.reply({
        content: message,
        ephemeral: true,
      }).catch(() => {});
    }
  }
});

process.on("unhandledRejection", (error) => {
  console.error(
    "Unhandled rejection:",
    error
  );
});

process.on("uncaughtException", (error) => {
  console.error(
    "Uncaught exception:",
    error
  );
});

client.login(CONFIG.token);
