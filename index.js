import os, re

path="/mnt/data/ltc-aesthetic-manager/index.js"
with open(path,"r",encoding="utf-8") as f:
    code=f.read()

# Make the balance embed substantially richer.
start=code.index("async function buildBalanceEmbed(wallet) {")
end=code.index("\nfunction balanceButtons()", start)

balance=r'''async function buildBalanceEmbed(wallet) {
  const confirmed = litoshiToLtc(wallet.final_balance);
  const unconfirmed = litoshiToLtc(wallet.unconfirmed_balance);
  const totalReceived = litoshiToLtc(wallet.total_received);
  const totalSent = litoshiToLtc(wallet.total_sent);
  const txCount = wallet.final_n_tx ?? wallet.n_tx ?? 0;
  const price = await fetchLtcPrice();

  const usdBalance = price.usd !== null ? confirmed * price.usd : null;
  const eurBalance = price.eur !== null ? confirmed * price.eur : null;

  return new EmbedBuilder()
    .setColor(0xB8FF4A)
    .setAuthor({
      name: "SNACHZ LTC • PERSONAL WALLET",
      iconURL: "https://cryptologos.cc/logos/litecoin-ltc-logo.png?v=040"
    })
    .setTitle("✦  WALLET DASHBOARD")
    .setDescription(
      "```ansi\n" +
      "\u001b[1;37mSNACHZ LTC\u001b[0m  /  \u001b[1;32mLIVE WALLET\u001b[0m\n" +
      "```\n" +
      "╭─ **Portfolio Overview**\n" +
      `╰─ ${explorerAddressLink()}\n\n` +
      `### 💎 ${fmtLtc(confirmed)}\n` +
      `> **${fmtMoney(usdBalance, "USD")}**  ·  **${fmtMoney(eurBalance, "EUR")}**`
    )
    .addFields(
      {
        name: "╭─ 💰 PORTFOLIO",
        value:
          `**LTC**  \`${fmtLtc(confirmed)}\`\n` +
          `**USD**  \`${fmtMoney(usdBalance, "USD")}\`\n` +
          `**EUR**  \`${fmtMoney(eurBalance, "EUR")}\``,
        inline: true
      },
      {
        name: "╭─ 📊 ACTIVITY",
        value:
          `📥 **Received**\n${moneyPair(totalReceived, price)}\n\n` +
          `📤 **Sent**\n${moneyPair(totalSent, price)}`,
        inline: true
      },
      {
        name: "╭─ ⛓️ NETWORK",
        value:
          `Transactions: **${Number(txCount).toLocaleString()}**\n` +
          `Unconfirmed: **${fmtLtc(unconfirmed)}**\n` +
          `Network: **Litecoin Mainnet**`,
        inline: true
      },
      {
        name: "╭─ 📈 MARKET",
        value:
          price.usd !== null
            ? `LTC / USD  **${fmtMoney(price.usd, "USD")}**\n` +
              `LTC / EUR  **${fmtMoney(price.eur, "EUR")}**`
            : "Market data unavailable",
        inline: true
      },
      {
        name: "╭─ 🔐 SECURITY",
        value:
          "🟢 **READ-ONLY**\n" +
          "No private key stored\n" +
          "No wallet signing",
        inline: true
      },
      {
        name: "╭─ ⚡ MONITOR",
        value:
          `🟢 **ONLINE**\n` +
          `Checking every **${CONFIG.checkInterval}s**\n` +
          "Live blockchain data",
        inline: true
      }
    )
    .addFields({
      name: "📍 TRACKED WALLET",
      value: `\`${CONFIG.address}\`\n[Open Litecoin Explorer ↗](${walletAddressUrl()})`,
      inline: false
    })
    .setFooter({
      text: "SNACHZ LTC • Personal Wallet Manager • Live blockchain data"
    })
    .setTimestamp();
}
'''
code=code[:start]+balance+code[end:]

# Replace history embed with LTC/USD/EUR per transaction.
start=code.index("      return interaction.editReply({\n        embeds: [", code.index('if (interaction.commandName === "history")'))
end=code.index("      });", start)+len("      });")

history=r'''      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xB8FF4A)
            .setAuthor({
              name: "SNACHZ LTC • TRANSACTION HISTORY",
              iconURL: "https://cryptologos.cc/logos/litecoin-ltc-logo.png?v=040"
            })
            .setTitle("✦  RECENT ACTIVITY")
            .setDescription(
              `Showing the latest **${unique.length}** transaction(s).\n` +
              `Wallet: ${explorerAddressLink()}`
            )
            .addFields(
              ...unique.map((ref, i) => {
                const type = classifyRef(ref);
                const amount = litoshiToLtc(ref.value);
                const sign = type === "received" ? "+" : type === "sent" ? "-" : "";
                const price = null;
                const status = Number(ref.confirmations || 0) > 0 ? "🟢 Confirmed" : "🟡 Unconfirmed";

                return {
                  name: `${i + 1}. ${type === "received" ? "📥 RECEIVED" : type === "sent" ? "📤 SENT" : "⛓️ TRANSACTION"}`,
                  value:
                    `**${sign}${fmtLtc(amount)}**\n` +
                    `USD/EUR values use the latest available LTC market price.\n` +
                    `${status} · ${Number(ref.confirmations || 0)} confirmation(s)\n` +
                    `[${shortHash(ref.tx_hash)} ↗](${explorerUrl(ref.tx_hash)})`,
                  inline: false
                };
              })
            )
            .setFooter({
              text: "SNACHZ LTC • Litecoin Mainnet • Transaction History"
            })
            .setTimestamp()
        ]
      });'''
# The exact old history block may differ; replace the final history return by locating its block.
old_segment=code[start:end]
# Instead of relying on exact content, locate from "return interaction.editReply" to its matching nearby "});"
# Use the current old segment replacement if it contains Recent Activity.
code=code[:start]+history+code[end:]

# The history currently needs market price per tx; make it actually fetch once and format values.
history_marker='''      const lines = unique.map((ref, i) => {'''
# We'll change the entire history section to a cleaner implementation.
hs=code.index('    if (interaction.commandName === "history") {')
he=code.index('    }\n  } catch (error) {', hs)
new_history=r'''    if (interaction.commandName === "history") {
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

      const price = await fetchLtcPrice();

      const fields = unique.map((ref, i) => {
        const type = classifyRef(ref);
        const amount = litoshiToLtc(ref.value);
        const sign = type === "received" ? "+" : type === "sent" ? "-" : "";
        const usd = price.usd !== null ? amount * price.usd : null;
        const eur = price.eur !== null ? amount * price.eur : null;
        const status = Number(ref.confirmations || 0) > 0
          ? "🟢 Confirmed"
          : "🟡 Unconfirmed";

        return {
          name: `${i + 1}  ${type === "received" ? "📥 RECEIVED" : type === "sent" ? "📤 SENT" : "⛓️ TRANSACTION"}`,
          value:
            `**${sign}${fmtLtc(amount)}**\n` +
            `💵 ${fmtMoney(usd, "USD")}  ·  💶 ${fmtMoney(eur, "EUR")}\n` +
            `${status}  ·  **${Number(ref.confirmations || 0)}** confirmation(s)\n` +
            `[${shortHash(ref.tx_hash)} ↗](${explorerUrl(ref.tx_hash)})`,
          inline: false
        };
      });

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xB8FF4A)
            .setAuthor({
              name: "SNACHZ LTC • TRANSACTION HISTORY",
              iconURL: "https://cryptologos.cc/logos/litecoin-ltc-logo.png?v=040"
            })
            .setTitle("✦  RECENT ACTIVITY")
            .setDescription(
              `Latest **${unique.length}** transaction(s) for your wallet.\n` +
              `Market conversion: **LTC → USD / EUR**`
            )
            .addFields(fields)
            .addFields({
              name: "📍 WALLET",
              value: explorerAddressLink(),
              inline: false
            })
            .setFooter({
              text: "SNACHZ LTC • Litecoin Mainnet • Live blockchain data"
            })
            .setTimestamp()
        ]
      });
    }'''
code=code[:hs]+new_history+code[he:]

# Make status explicitly say Managing Snachz LTC.
ss=code.index('    if (interaction.commandName === "status") {')
se=code.index('    }\n\n    if (interaction.commandName === "history")', ss)
status=r'''    if (interaction.commandName === "status") {
      const wallet = await fetchWallet();

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setAuthor({
              name: "SNACHZ LTC • SYSTEM STATUS",
              iconURL: "https://cryptologos.cc/logos/litecoin-ltc-logo.png?v=040"
            })
            .setTitle("✦  MONITOR STATUS")
            .setDescription(
              "```ansi\n" +
              "\u001b[1;32m● ONLINE\u001b[0m  SNACHZ LTC is being managed\n" +
              "```\n" +
              "Your private Litecoin monitor is operating normally."
            )
            .addFields(
              { name: "🤖 BOT", value: "🟢 **ONLINE**", inline: true },
              { name: "⛓️ BLOCKCHAIN", value: "🟢 **CONNECTED**", inline: true },
              { name: "📡 MONITOR", value: `Every **${CONFIG.checkInterval}s**`, inline: true },
              { name: "💎 WALLET", value: "**LTC Mainnet**", inline: true },
              { name: "🔄 KNOWN TXs", value: `**${state.knownTransactions.length}**`, inline: true },
              { name: "📊 WALLET TXs", value: `**${wallet.final_n_tx ?? wallet.n_tx ?? 0}**`, inline: true },
              { name: "🔐 MODE", value: "🔒 **READ-ONLY**", inline: true },
              { name: "👤 MANAGING", value: "**Snachz LTC**", inline: true }
            )
            .addFields({
              name: "📍 TRACKED ADDRESS",
              value: `\`${CONFIG.address}\``,
              inline: false
            })
            .setFooter({
              text: "SNACHZ LTC • Personal Wallet Manager"
            })
            .setTimestamp()
        ],
        ephemeral: true
      });
    }'''
code=code[:ss]+status+code[se:]

with open(path,"w",encoding="utf-8") as f:
    f.write(code)

print(path)
