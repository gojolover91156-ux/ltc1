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
  MessageFlags,
} = require("discord.js");

/* =========================================================
   CONFIG
========================================================= */

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
    15,
  ),
};

if (!CONFIG.token) {
  console.error("Missing DISCORD_TOKEN.");
  process.exit(1);
}

if (!CONFIG.clientId) {
  console.error("Missing CLIENT_ID.");
  process.exit(1);
}

if (!CONFIG.ownerId) {
  console.error("Missing OWNER_ID.");
  process.exit(1);
}

/* =========================================================
   CLIENT
========================================================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

/* =========================================================
   API
========================================================= */

const BLOCKCYPHER_API =
  "https://api.blockcypher.com/v1/ltc/main";

const COINGECKO_API =
  "https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd,eur";

/* =========================================================
   STATE
========================================================= */

let previousTxHashes = new Set();

/* =========================================================
   COMMANDS
========================================================= */

const commands = [
  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("View your SNACHZ LTC wallet balance."),

  new SlashCommandBuilder()
    .setName("bal")
    .setDescription("Check the balance of any public Litecoin address.")
    .addStringOption((option) =>
      option
        .setName("ltc")
        .setDescription("Public Litecoin address.")
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("history")
    .setDescription("View your SNACHZ LTC wallet history.")
    .addIntegerOption((option) =>
      option
        .setName("count")
        .setDescription("Number of transactions to show.")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10),
    ),

  new SlashCommandBuilder()
    .setName("address")
    .setDescription("Show your tracked LTC address."),

  new SlashCommandBuilder()
    .setName("refresh")
    .setDescription("Refresh your wallet information."),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show SNACHZ LTC manager status."),
].map((command) => command.toJSON());

/* =========================================================
   BASIC HELPERS
========================================================= */

function isOwner(interaction) {
  return interaction.user?.id === CONFIG.ownerId;
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
    },
  )}`;
}

function walletAddressUrl(address = CONFIG.ltcAddress) {
  return `https://litecoinspace.org/address/${address}`;
}

function txUrl(hash) {
  return `https://litecoinspace.org/tx/${hash}`;
}

function shortAddress(address) {
  if (!address || address.length < 16) {
    return address;
  }

  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

function isValidLitecoinAddress(address) {
  if (!address) return false;

  const clean = address.trim();

  /*
   Litecoin mainnet addresses commonly start with:
   L / M / 3 / ltc1

   This intentionally only validates the format.
   The blockchain API remains the final check.
  */

  if (clean.startsWith("ltc1")) {
    return /^ltc1[a-z0-9]{20,90}$/i.test(clean);
  }

  if (
    clean.startsWith("L") ||
    clean.startsWith("M")
  ) {
    return /^[LM][a-km-zA-HJ-NP-Z1-9]{25,40}$/.test(
      clean,
    );
  }

  if (clean.startsWith("3")) {
    return /^3[a-km-zA-HJ-NP-Z1-9]{25,40}$/.test(
      clean,
    );
  }

  return false;
}

function securityText() {
  return [
    "READ-ONLY",
    "No private key stored",
    "No seed phrase required",
    "Public address tracking only",
  ].join("\n");
}

/* =========================================================
   LTC PRICE
========================================================= */

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
  } catch (error) {
    console.error(
      "CoinGecko price error:",
      error.message,
    );

    return {
      usd: 0,
      eur: 0,
    };
  }
}

/* =========================================================
   BLOCKCHAIN WALLET FETCH
========================================================= */

async function fetchWallet(address = CONFIG.ltcAddress) {
  const response = await fetch(
    `${BLOCKCYPHER_API}/addrs/${encodeURIComponent(
      address,
    )}/full?limit=50`,
  );

  if (!response.ok) {
    let details = "";

    try {
      const data = await response.json();

      if (data?.error) {
        details = ` - ${data.error}`;
      }
    } catch {}

    throw new Error(
      `BlockCypher returned HTTP ${response.status}${details}`,
    );
  }

  return response.json();
}

/* =========================================================
   BUTTONS
========================================================= */

function balanceButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("refresh_balance")
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setLabel("Explorer")
      .setStyle(ButtonStyle.Link)
      .setURL(walletAddressUrl()),
  );
}

/* =========================================================
   OWN WALLET BALANCE
========================================================= */

async function createBalanceEmbed() {
  const wallet = await fetchWallet(
    CONFIG.ltcAddress,
  );

  const prices = await fetchLtcPrice();

  const balance = litoshiToLtc(
    wallet.balance,
  );

  const totalReceived = litoshiToLtc(
    wallet.total_received,
  );

  const totalSent = litoshiToLtc(
    wallet.total_sent,
  );

  const unconfirmed = litoshiToLtc(
    wallet.unconfirmed_balance,
  );

  const confirmedUsd =
    balance * prices.usd;

  const confirmedEur =
    balance * prices.eur;

  return new EmbedBuilder()
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

        `> **Tracked wallet:** [${shortAddress(
          CONFIG.ltcAddress,
        )}](${walletAddressUrl()})`,

        "",

        "### ◈ PORTFOLIO VALUE",

        `**${fmtLtc(balance)}**`,

        `**${fmtMoney(
          confirmedUsd,
          "USD",
        )}**  •  **${fmtMoney(
          confirmedEur,
          "EUR",
        )}**`,
      ].join("\n"),
    )

    .addFields(
      {
        name: "▸ PORTFOLIO",
        value: [
          `**LTC**  ${fmtLtc(balance)}`,
          `**USD**  ${fmtMoney(
            confirmedUsd,
            "USD",
          )}`,
          `**EUR**  ${fmtMoney(
            confirmedEur,
            "EUR",
          )}`,
        ].join("\n"),
        inline: true,
      },

      {
        name: "▸ ACTIVITY",
        value: [
          `Received: **${fmtLtc(
            totalReceived,
          )}**`,
          `Sent: **${fmtLtc(
            totalSent,
          )}**`,
          `Pending: **${fmtLtc(
            unconfirmed,
          )}**`,
        ].join("\n"),
        inline: true,
      },

      {
        name: "▸ NETWORK",
        value: [
          `Transactions: **${
            wallet.n_tx || 0
          }**`,
          `Unconfirmed: **${
            wallet.unconfirmed_n_tx || 0
          }**`,
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
            },
          )}**`,

          `LTC/EUR: **€${prices.eur.toLocaleString(
            "en-US",
            {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            },
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
      },
    )

    .setFooter({
      text:
        "SNACHZ LTC • Personal Wallet Manager • Live blockchain data",
    })

    .setTimestamp();
}

/* =========================================================
   PUBLIC ADDRESS BALANCE
   /bal ltc:<address>
========================================================= */

async function createPublicBalanceEmbed(
  address,
) {
  const wallet = await fetchWallet(address);
  const prices = await fetchLtcPrice();

  const balance = litoshiToLtc(
    wallet.balance,
  );

  const unconfirmed = litoshiToLtc(
    wallet.unconfirmed_balance,
  );

  const totalReceived = litoshiToLtc(
    wallet.total_received,
  );

  const totalSent = litoshiToLtc(
    wallet.total_sent,
  );

  const usd = balance * prices.usd;
  const eur = balance * prices.eur;

  return new EmbedBuilder()
    .setColor(0xb8ff4a)

    .setAuthor({
      name: "SNACHZ LTC • PUBLIC LOOKUP",
    })

    .setTitle("✦  LTC ADDRESS BALANCE")

    .setDescription(
      [
        "```ansi",
        "\u001b[1;32mPUBLIC ADDRESS LOOKUP\u001b[0m",
        "\u001b[2;37mREAD-ONLY BLOCKCHAIN DATA\u001b[0m",
        "```",

        `**Address**`,
        `[\`${address}\`](${walletAddressUrl(
          address,
        )})`,

        "",

        "### ◈ CURRENT BALANCE",

        `**${fmtLtc(balance)}**`,

        `**${fmtMoney(
          usd,
          "USD",
        )}**  •  **${fmtMoney(
          eur,
          "EUR",
        )}**`,
      ].join("\n"),
    )

    .addFields(
      {
        name: "▸ BALANCE",
        value: [
          `LTC: **${fmtLtc(
            balance,
          )}**`,
          `USD: **${fmtMoney(
            usd,
            "USD",
          )}**`,
          `EUR: **${fmtMoney(
            eur,
            "EUR",
          )}**`,
        ].join("\n"),
        inline: true,
      },

      {
        name: "▸ ACTIVITY",
        value: [
          `Received: **${fmtLtc(
            totalReceived,
          )}**`,
          `Sent: **${fmtLtc(
            totalSent,
          )}**`,
          `Pending: **${fmtLtc(
            unconfirmed,
          )}**`,
        ].join("\n"),
        inline: true,
      },

      {
        name: "▸ NETWORK",
        value: [
          `Transactions: **${
            wallet.n_tx || 0
          }**`,
          `Unconfirmed: **${
            wallet.unconfirmed_n_tx || 0
          }**`,
          "Network: **Litecoin Mainnet**",
        ].join("\n"),
        inline: true,
      },

      {
        name: "▸ MARKET",
        value: [
          `LTC/USD: **$${prices.usd.toFixed(
            2,
          )}**`,
          `LTC/EUR: **€${prices.eur.toFixed(
            2,
          )}**`,
        ].join("\n"),
        inline: true,
      },

      {
        name: "▸ MODE",
        value:
          "PUBLIC ADDRESS • READ-ONLY",
        inline: true,
      },

      {
        name: "▸ EXPLORER",
        value: `[Open address](${walletAddressUrl(
          address,
        )})`,
        inline: true,
      },
    )

    .setFooter({
      text:
        "SNACHZ LTC • Public Litecoin Address Lookup",
    })

    .setTimestamp();
}

/* =========================================================
   WALLET-SPECIFIC HISTORY
========================================================= */

async function createHistoryEmbed(
  count = 5,
) {
  const wallet = await fetchWallet(
    CONFIG.ltcAddress,
  );

  const prices = await fetchLtcPrice();

  const txs = wallet.txs || [];

  const embed = new EmbedBuilder()
    .setColor(0xb8ff4a)

    .setAuthor({
      name:
        "SNACHZ LTC • WALLET HISTORY",
    })

    .setTitle(
      "✦  YOUR WALLET ACTIVITY",
    )

    .setDescription(
      [
        `Showing the latest **${Math.min(
          count,
          txs.length,
        )}** transactions for your wallet.`,

        "",

        `**Wallet:** [${shortAddress(
          CONFIG.ltcAddress,
        )}](${walletAddressUrl()})`,

        "",

        `Market: **1 LTC ≈ $${prices.usd.toFixed(
          2,
        )} / €${prices.eur.toFixed(2)}**`,
      ].join("\n"),
    );

  if (!txs.length) {
    embed.addFields({
      name: "NO TRANSACTIONS",
      value:
        "No transactions were found for your LTC wallet.",
    });
  } else {
    for (const tx of txs.slice(0, count)) {
      const walletInputs =
        tx.inputs?.filter((input) =>
          (input.addresses || []).includes(
            CONFIG.ltcAddress,
          ),
        ) || [];

      const walletOutputs =
        tx.outputs?.filter((output) =>
          (output.addresses || []).includes(
            CONFIG.ltcAddress,
          ),
        ) || [];

      const receivedLitoshi =
        walletOutputs.reduce(
          (sum, output) =>
            sum +
            Number(output.value || 0),
          0,
        );

      const sentLitoshi =
        walletInputs.reduce(
          (sum, input) =>
            sum +
            Number(
              input.output_value || 0,
            ),
          0,
        );

      let amountLitoshi = 0;
      let type = "TRANSACTION";

      /*
       Incoming:
       wallet receives LTC.

       Outgoing:
       wallet spends LTC.

       Transfer:
       wallet spends LTC and also receives
       change back in the same transaction.
      */

      if (
        sentLitoshi > 0 &&
        receivedLitoshi > 0
      ) {
        amountLitoshi = Math.max(
          sentLitoshi -
            receivedLitoshi,
          0,
        );

        type = "SENT";
      } else if (
        receivedLitoshi > 0
      ) {
        amountLitoshi =
          receivedLitoshi;

        type = "RECEIVED";
      } else if (
        sentLitoshi > 0
      ) {
        amountLitoshi =
          sentLitoshi;

        type = "SENT";
      }

      /*
       Fallback for unusual BlockCypher
       transaction structures.
      */

      if (
        amountLitoshi <= 0 &&
        Number(tx.total || 0) !== 0
      ) {
        amountLitoshi = Math.abs(
          Number(tx.total || 0),
        );
      }

      const amount = litoshiToLtc(
        amountLitoshi,
      );

      const confirmations = Number(
        tx.confirmations || 0,
      );

      const status =
        confirmations > 0
          ? `Confirmed • ${confirmations} confirmations`
          : "Unconfirmed";

      const usd =
        amount * prices.usd;

      const eur =
        amount * prices.eur;

      embed.addFields({
        name: `${type} • ${fmtLtc(
          amount,
        )}`,

        value: [
          `USD: **${fmtMoney(
            usd,
            "USD",
          )}**`,

          `EUR: **${fmtMoney(
            eur,
            "EUR",
          )}**`,

          `Status: **${status}**`,

          `[View transaction](${txUrl(
            tx.hash,
          )})`,
        ].join("\n"),

        inline: false,
      });
    }
  }

  embed

    .setFooter({
      text:
        "SNACHZ LTC • Your wallet • Litecoin Mainnet",
    })

    .setTimestamp();

  return embed;
}

/* =========================================================
   ADDRESS EMBED
========================================================= */

function createAddressEmbed() {
  return new EmbedBuilder()
    .setColor(0xb8ff4a)

    .setAuthor({
      name:
        "SNACHZ LTC • WALLET ADDRESS",
    })

    .setTitle(
      "✦  TRACKED ADDRESS",
    )

    .setDescription(
      [
        "```",
        CONFIG.ltcAddress,
        "```",

        `[Open LitecoinSpace Explorer](${walletAddressUrl()})`,
      ].join("\n"),
    )

    .setFooter({
      text:
        "SNACHZ LTC • Read-only wallet manager",
    })

    .setTimestamp();
}

/* =========================================================
   STATUS
========================================================= */

async function createStatusEmbed() {
  const wallet = await fetchWallet(
    CONFIG.ltcAddress,
  );

  return new EmbedBuilder()
    .setColor(0xb8ff4a)

    .setAuthor({
      name:
        "SNACHZ LTC • SYSTEM STATUS",
    })

    .setTitle(
      "✦  MONITOR STATUS",
    )

    .setDescription(
      [
        "```ansi",
        "\u001b[1;32m● ONLINE\u001b[0m",
        "\u001b[2;37mSNACHZ LTC is being managed\u001b[0m",
        "```",
      ].join("\n"),
    )

    .addFields(
      {
        name: "BOT",
        value: "ONLINE",
        inline: true,
      },

      {
        name: "BLOCKCHAIN",
        value: "CONNECTED",
        inline: true,
      },

      {
        name: "MONITOR",
        value: `Every **${CONFIG.checkInterval}s**`,
        inline: true,
      },

      {
        name: "WALLET",
        value: "LTC Mainnet",
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
        value: "READ-ONLY",
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
      },
    )

    .setFooter({
      text:
        "SNACHZ LTC • Private Wallet Manager",
    })

    .setTimestamp();
}

/* =========================================================
   TRANSACTION ALERT
========================================================= */

async function sendNewTransactionAlert(
  tx,
) {
  if (!CONFIG.alertChannelId) {
    return;
  }

  try {
    const channel =
      await client.channels.fetch(
        CONFIG.alertChannelId,
      );

    if (!channel?.isTextBased()) {
      return;
    }

    const prices =
      await fetchLtcPrice();

    const amount =
      litoshiToLtc(
        Math.abs(
          Number(tx.total || 0),
        ),
      );

    const embed = new EmbedBuilder()
      .setColor(0xb8ff4a)

      .setAuthor({
        name:
          "SNACHZ LTC • WALLET ALERT",
      })

      .setTitle(
        "✦  NEW TRANSACTION",
      )

      .setDescription(
        [
          `**${fmtLtc(amount)}**`,

          `${moneyPair(
            amount,
            prices,
          )}`,

          "",

          `[View transaction](${txUrl(
            tx.hash,
          )})`,
        ].join("\n"),
      )

      .addFields({
        name: "WALLET",
        value: `[\`${CONFIG.ltcAddress}\`](${walletAddressUrl()})`,
      })

      .setFooter({
        text:
          "SNACHZ LTC • Live blockchain monitor",
      })

      .setTimestamp();

    await channel.send({
      embeds: [embed],
    });
  } catch (error) {
    console.error(
      "Failed to send transaction alert:",
      error.message,
    );
  }
}

/* =========================================================
   MONITOR
========================================================= */

async function monitorWallet() {
  try {
    const wallet =
      await fetchWallet(
        CONFIG.ltcAddress,
      );

    const txs = wallet.txs || [];

    const currentHashes =
      new Set(
        txs
          .map((tx) => tx.hash)
          .filter(Boolean),
      );

    if (
      previousTxHashes.size > 0
    ) {
      for (const tx of txs) {
        if (
          tx.hash &&
          !previousTxHashes.has(
            tx.hash,
          )
        ) {
          await sendNewTransactionAlert(
            tx,
          );
        }
      }
    }

    previousTxHashes =
      currentHashes;
  } catch (error) {
    console.error(
      "Wallet monitor error:",
      error.message,
    );
  }
}

/* =========================================================
   REGISTER COMMANDS
========================================================= */

async function registerCommands() {
  const rest = new REST({
    version: "10",
  }).setToken(CONFIG.token);

  await rest.put(
    Routes.applicationCommands(
      CONFIG.clientId,
    ),
    {
      body: commands,
    },
  );

  console.log(
    "Global slash commands registered successfully.",
  );
}

/* =========================================================
   CLIENT READY
========================================================= */

client.once(
  "clientReady",
  async () => {
    console.log(
      `Logged in as ${client.user.tag}`,
    );

    try {
      await registerCommands();

      const wallet =
        await fetchWallet(
          CONFIG.ltcAddress,
        );

      previousTxHashes =
        new Set(
          (wallet.txs || [])
            .map((tx) => tx.hash)
            .filter(Boolean),
        );

      console.log(
        `Tracking LTC wallet: ${CONFIG.ltcAddress}`,
      );

      console.log(
        `Monitor interval: ${CONFIG.checkInterval}s`,
      );

      setInterval(
        monitorWallet,
        CONFIG.checkInterval * 1000,
      );
    } catch (error) {
      console.error(
        "Startup error:",
        error,
      );
    }
  },
);

/* =========================================================
   INTERACTIONS
========================================================= */

client.on(
  "interactionCreate",
  async (interaction) => {
    try {
      /* =====================================================
         REFRESH BUTTON
      ===================================================== */

      if (
        interaction.isButton() &&
        interaction.customId ===
          "refresh_balance"
      ) {
        if (!isOwner(interaction)) {
          return interaction.reply({
            content:
              "You are not authorized to use this wallet manager.",
            flags:
              MessageFlags.Ephemeral,
          });
        }

        await interaction.deferUpdate();

        const embed =
          await createBalanceEmbed();

        await interaction.editReply({
          embeds: [embed],
          components: [
            balanceButtons(),
          ],
        });

        return;
      }

      /* =====================================================
         CHAT INPUT ONLY
      ===================================================== */

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      /* =====================================================
         OWNER CHECK
      ===================================================== */

      if (!isOwner(interaction)) {
        return interaction.reply({
          content:
            "You are not authorized to use SNACHZ LTC.",
          flags:
            MessageFlags.Ephemeral,
        });
      }

      /* =====================================================
         /balance
      ===================================================== */

      if (
        interaction.commandName ===
        "balance"
      ) {
        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral,
        });

        const embed =
          await createBalanceEmbed();

        await interaction.editReply({
          embeds: [embed],
          components: [
            balanceButtons(),
          ],
        });

        return;
      }

      /* =====================================================
         /bal ltc:<ADDRESS>
      ===================================================== */

      if (
        interaction.commandName ===
        "bal"
      ) {
        const address =
          interaction.options
            .getString("ltc")
            ?.trim();

        if (
          !address ||
          !isValidLitecoinAddress(
            address,
          )
        ) {
          return interaction.reply({
            content:
              "Invalid Litecoin address. Please provide a valid public LTC mainnet address.",
            flags:
              MessageFlags.Ephemeral,
          });
        }

        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral,
        });

        try {
          const embed =
            await createPublicBalanceEmbed(
              address,
            );

          await interaction.editReply({
            embeds: [embed],
          });
        } catch (error) {
          console.error(
            "/bal error:",
            error,
          );

          await interaction.editReply({
            content:
              "Could not fetch that Litecoin address. Make sure the address is a valid LTC mainnet address.",
            embeds: [],
          });
        }

        return;
      }

      /* =====================================================
         /history
      ===================================================== */

      if (
        interaction.commandName ===
        "history"
      ) {
        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral,
        });

        const count =
          interaction.options.getInteger(
            "count",
          ) || 5;

        const embed =
          await createHistoryEmbed(
            count,
          );

        await interaction.editReply({
          embeds: [embed],
        });

        return;
      }

      /* =====================================================
         /address
      ===================================================== */

      if (
        interaction.commandName ===
        "address"
      ) {
        await interaction.reply({
          embeds: [
            createAddressEmbed(),
          ],
          flags:
            MessageFlags.Ephemeral,
        });

        return;
      }

      /* =====================================================
         /refresh
      ===================================================== */

      if (
        interaction.commandName ===
        "refresh"
      ) {
        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral,
        });

        const embed =
          await createBalanceEmbed();

        await interaction.editReply({
          embeds: [embed],
          components: [
            balanceButtons(),
          ],
        });

        return;
      }

      /* =====================================================
         /status
      ===================================================== */

      if (
        interaction.commandName ===
        "status"
      ) {
        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral,
        });

        const embed =
          await createStatusEmbed();

        await interaction.editReply({
          embeds: [embed],
        });

        return;
      }
    } catch (error) {
      console.error(
        "Interaction error:",
        error,
      );

      const message =
        "Something went wrong while processing the request.";

      try {
        if (
          interaction.deferred ||
          interaction.replied
        ) {
          await interaction.editReply({
            content: message,
            embeds: [],
            components: [],
          });
        } else {
          await interaction.reply({
            content: message,
            flags:
              MessageFlags.Ephemeral,
          });
        }
      } catch (replyError) {
        console.error(
          "Failed to send error response:",
          replyError.message,
        );
      }
    }
  },
);

/* =========================================================
   PROCESS ERRORS
========================================================= */

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "Unhandled rejection:",
      error,
    );
  },
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "Uncaught exception:",
      error,
    );
  },
);

/* =========================================================
   LOGIN
========================================================= */

client.login(CONFIG.token);
