import {
  Client, GatewayIntentBits, Events, EmbedBuilder,
  PermissionFlagsBits, TextChannel, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ChannelType, OverwriteType,
  BaseGuildTextChannel, DMChannel,
} from "discord.js";
import OpenAI from "openai";

const PREFIX = "+";
const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) { console.error("DISCORD_BOT_TOKEN not set!"); process.exit(1); }

// ─── OPENAI ──────────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "missing" });
const conversationHistory = new Map();

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const guildConfigs = new Map();
function getConfig(guildId) {
  if (!guildConfigs.has(guildId)) guildConfigs.set(guildId, {
    antiLink: false, antiSpam: false, antiNuke: false, raidMode: false,
    ignoredChannels: new Set(), mediaOnlyChannels: new Set(),
    welcomeChannelId: null, welcomeMessage: "Welcome to the server, {user}! 🎉",
  });
  return guildConfigs.get(guildId);
}

// ─── AI ──────────────────────────────────────────────────────────────────────
async function handleAsk(message, args) {
  if (!args.length) { await message.reply("Usage: `+ask <question>`"); return; }
  const userId = message.author.id;
  if (!conversationHistory.has(userId)) conversationHistory.set(userId, [{ role: "system", content: "You are a helpful, friendly Discord bot. Keep responses under 1800 characters." }]);
  const history = conversationHistory.get(userId);
  history.push({ role: "user", content: args.join(" ") });
  if ("sendTyping" in message.channel) await message.channel.sendTyping();
  try {
    const res = await openai.chat.completions.create({ model: "gpt-4o-mini", max_completion_tokens: 500, messages: history });
    const reply = res.choices[0]?.message?.content ?? "Sorry, couldn't generate a response.";
    history.push({ role: "assistant", content: reply });
    if (history.length > 21) history.splice(1, 2);
    await message.reply(reply.slice(0, 1900));
  } catch { await message.reply("Sorry, I had trouble responding. Try again!"); }
}
async function handleClearChat(message) { conversationHistory.delete(message.author.id); await message.reply("Conversation history cleared!"); }

// ─── GAMES ───────────────────────────────────────────────────────────────────
const triviaPending = new Map();
const triviaQs = [
  { q: "Capital of France?", a: "paris" }, { q: "Sides on a hexagon?", a: "6" },
  { q: "Red Planet?", a: "mars" }, { q: "Who wrote Romeo and Juliet?", a: "shakespeare" },
  { q: "Largest ocean?", a: "pacific" }, { q: "Bones in the human body?", a: "206" },
  { q: "Chemical symbol for Gold?", a: "au" }, { q: "WWII ended in?", a: "1945" },
  { q: "Smallest prime number?", a: "2" }, { q: "Who painted the Mona Lisa?", a: "da vinci" },
  { q: "Fastest land animal?", a: "cheetah" }, { q: "Planets in solar system?", a: "8" },
  { q: "Language spoken in Brazil?", a: "portuguese" }, { q: "H2O is known as?", a: "water" },
];
async function handleTrivia(message) {
  const ch = message.channel;
  if (!(ch instanceof BaseGuildTextChannel || ch instanceof DMChannel)) return;
  if (triviaPending.has(message.channelId)) { await message.reply("A trivia is already active! Answer it first."); return; }
  const q = triviaQs[Math.floor(Math.random() * triviaQs.length)];
  const timeout = setTimeout(async () => { triviaPending.delete(message.channelId); await ch.send(`Time's up! Answer was **${q.a}**.`); }, 30000);
  triviaPending.set(message.channelId, { answer: q.a, timeout });
  await ch.send(`**TRIVIA!** 30 seconds!\n\n**${q.q}**\n\nType your answer!`);
}
function checkTriviaAnswer(message) {
  if (!triviaPending.has(message.channelId)) return false;
  const pending = triviaPending.get(message.channelId);
  if (message.content.toLowerCase().includes(pending.answer)) {
    clearTimeout(pending.timeout); triviaPending.delete(message.channelId);
    message.reply(`Correct! Well done, ${message.author.username}!`); return true;
  }
  return false;
}
async function handleRoll(message, args) { let s = 6; if (args[0]) { const p = parseInt(args[0]); if (!isNaN(p) && p >= 2 && p <= 1000) s = p; } await message.reply(`You rolled **${Math.floor(Math.random() * s) + 1}** (d${s})`); }
async function handleCoinflip(message) { await message.reply(`**${Math.random() < 0.5 ? "Heads" : "Tails"}**!`); }
async function handle8Ball(message, args) {
  if (!args.length) { await message.reply("Ask a question! Usage: `+8ball <question>`"); return; }
  const r = ["It is certain.", "Without a doubt.", "Yes!", "Most likely.", "Ask again later.", "Cannot predict now.", "Don't count on it.", "My reply is no.", "Very doubtful."];
  await message.reply(`🎱 ${r[Math.floor(Math.random() * r.length)]}`);
}
async function handleRps(message, args) {
  const choices = ["rock", "paper", "scissors"];
  const u = args[0]?.toLowerCase();
  if (!choices.includes(u)) { await message.reply("Choose rock, paper, or scissors!"); return; }
  const b = choices[Math.floor(Math.random() * 3)];
  const emoji = { rock: "🪨", paper: "📄", scissors: "✂️" };
  let result = u === b ? "Tie!" : ((u === "rock" && b === "scissors") || (u === "paper" && b === "rock") || (u === "scissors" && b === "paper")) ? "You win! 🎉" : "I win! 😎";
  await message.reply(`You: ${emoji[u]} ${u}\nMe: ${emoji[b]} ${b}\n\n**${result}**`);
}
async function handleGuess(message) {
  const ch = message.channel;
  if (!(ch instanceof BaseGuildTextChannel || ch instanceof DMChannel)) return;
  const number = Math.floor(Math.random() * 10) + 1;
  await message.reply("Guess a number between 1–10! You have 3 tries:");
  const filter = m => m.author.id === message.author.id && !isNaN(parseInt(m.content));
  const collector = ch.createMessageCollector({ filter, max: 3, time: 30000 });
  let won = false;
  collector.on("collect", async m => {
    const g = parseInt(m.content);
    if (g === number) { won = true; collector.stop(); await m.reply(`🎉 Correct! It was **${number}**!`); }
    else if (collector.collected.size < 3) await m.reply(g < number ? "Too low!" : "Too high!");
  });
  collector.on("end", async (_, reason) => { if (!won) await ch.send(`Game over! It was **${number}**.`); });
}

// ─── MODERATION ──────────────────────────────────────────────────────────────
const snipeCache = new Map();
function cacheDeletedMessage(message) {
  if (message.author?.bot) return;
  snipeCache.set(message.channelId, { content: message.content || "[attachment]", author: message.author?.tag, avatar: message.author?.displayAvatarURL(), deletedAt: new Date() });
}
function requirePerm(message, perm) { if (!message.member?.permissions.has(perm)) { message.reply("You don't have permission."); return false; } return true; }
function getMentioned(message) { return message.mentions.members?.first() ?? null; }

async function handleKick(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.KickMembers)) return;
  const t = getMentioned(message); if (!t) { await message.reply("Mention a user! Usage: `+kick @user [reason]`"); return; }
  try { await t.kick(args.slice(1).join(" ") || "No reason"); await message.reply(`✅ **${t.user.username}** kicked.`); } catch { await message.reply("Couldn't kick. Check my permissions."); }
}
async function handleBan(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.BanMembers)) return;
  const t = getMentioned(message); if (!t) { await message.reply("Mention a user! Usage: `+ban @user [reason]`"); return; }
  try { await t.ban({ reason: args.slice(1).join(" ") || "No reason" }); await message.reply(`✅ **${t.user.username}** banned.`); } catch { await message.reply("Couldn't ban. Check my permissions."); }
}
async function handleUnban(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.BanMembers)) return;
  if (!args[0]) { await message.reply("Usage: `+unban <userId>`"); return; }
  try { await message.guild.members.unban(args[0]); await message.reply(`✅ **${args[0]}** unbanned.`); } catch { await message.reply("No ban found for that ID."); }
}
async function handleMute(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.ModerateMembers)) return;
  const t = getMentioned(message); if (!t) { await message.reply("Mention a user!"); return; }
  const mins = Math.min(parseInt(args[1] ?? "10") || 10, 40320);
  try { await t.timeout(mins * 60000, `Muted by ${message.author.username}`); await message.reply(`✅ **${t.user.username}** muted for ${mins} min.`); } catch { await message.reply("Couldn't mute. Check my permissions."); }
}
async function handleUnmute(message) {
  if (!requirePerm(message, PermissionFlagsBits.ModerateMembers)) return;
  const t = getMentioned(message); if (!t) { await message.reply("Mention a user!"); return; }
  try { await t.timeout(null); await message.reply(`✅ **${t.user.username}** unmuted.`); } catch { await message.reply("Couldn't unmute."); }
}
async function handlePurge(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.ManageMessages)) return;
  const n = parseInt(args[0]); if (isNaN(n) || n < 1 || n > 100) { await message.reply("Provide a number 1–100."); return; }
  if (!message.channel.isTextBased() || message.channel.isDMBased()) return;
  try { const d = await message.channel.bulkDelete(n + 1, true); const m = await message.channel.send(`Deleted **${d.size - 1}** messages.`); setTimeout(() => m.delete().catch(() => {}), 3000); }
  catch { await message.reply("Couldn't delete. Messages may be over 14 days old."); }
}
async function handleWarn(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.ModerateMembers)) return;
  const t = getMentioned(message); if (!t) { await message.reply("Mention a user!"); return; }
  const reason = args.slice(1).join(" ") || "No reason";
  try { await t.send(`⚠️ Warned in **${message.guild?.name}**: ${reason}`); await message.reply(`✅ **${t.user.username}** warned.`); }
  catch { await message.reply(`Warned **${t.user.username}** (couldn't DM).`); }
}
async function handleLock(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.ManageChannels) || !message.guild) return;
  const ch = (message.mentions.channels.first() ?? message.channel);
  try { await ch.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }); await message.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription(`🔒 <#${ch.id}> locked. Reason: ${args.filter(a => !a.startsWith("<")).join(" ") || "No reason"}`)] }); }
  catch { await message.reply("Couldn't lock. Check my permissions."); }
}
async function handleUnlock(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.ManageChannels) || !message.guild) return;
  const ch = (message.mentions.channels.first() ?? message.channel);
  try { await ch.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }); await message.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(`🔓 <#${ch.id}> unlocked.`)] }); }
  catch { await message.reply("Couldn't unlock. Check my permissions."); }
}
async function handleSnipe(message) {
  const s = snipeCache.get(message.channelId);
  if (!s) { await message.reply("Nothing to snipe!"); return; }
  await message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setAuthor({ name: s.author, iconURL: s.avatar }).setDescription(s.content).setFooter({ text: `Deleted at ${s.deletedAt.toLocaleTimeString()}` })] });
}

// ─── TEMPBAN ─────────────────────────────────────────────────────────────────
let _client = null;
function parseDur(str) {
  const m = str?.match(/^(\d+)(s|m|h|d|w)$/);
  if (!m) return null;
  return parseInt(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2]];
}
function fmtDur(ms) {
  if (ms < 60000) return `${ms / 1000}s`; if (ms < 3600000) return `${ms / 60000}m`;
  if (ms < 86400000) return `${ms / 3600000}h`; if (ms < 604800000) return `${ms / 86400000}d`;
  return `${ms / 604800000}w`;
}
async function handleTempban(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.BanMembers) || !message.guild) return;
  const t = getMentioned(message); if (!t) { await message.reply("Usage: `+tempban @user <duration> [reason]`"); return; }
  const ms = parseDur(args[1]); if (!ms) { await message.reply("Invalid duration. Use `1h`, `2d`, `1w`."); return; }
  const reason = args.slice(2).join(" ") || "No reason";
  try {
    await t.ban({ reason: `Tempban (${fmtDur(ms)}): ${reason}` });
    await message.reply(`⏱️ **${t.user.username}** temp-banned for **${fmtDur(ms)}**. Reason: ${reason}`);
    const guildId = message.guild.id; const userId = t.id; const username = t.user.username;
    setTimeout(async () => {
      const guild = _client?.guilds.cache.get(guildId); if (!guild) return;
      try { await guild.members.unban(userId, "Tempban expired"); await guild.systemChannel?.send(`✅ **${username}** auto-unbanned.`); } catch {}
    }, ms);
  } catch { await message.reply("Couldn't ban. Check permissions."); }
}

// ─── AUTO-MOD ────────────────────────────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s]+|discord\.gg\/[^\s]+|www\.[^\s]+/gi;
const spamTracker = new Map();
const raidTracker = new Map();

async function handleAntiLink(message) {
  if (!message.guild) return false;
  const cfg = getConfig(message.guild.id);
  if (!cfg.antiLink || message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return false;
  if (URL_RE.test(message.content)) {
    await message.delete().catch(() => {});
    const w = await message.channel.send(`${message.author}, links are not allowed!`);
    setTimeout(() => w.delete().catch(() => {}), 4000); return true;
  }
  return false;
}
async function handleAntiSpam(message) {
  if (!message.guild) return false;
  const cfg = getConfig(message.guild.id);
  if (!cfg.antiSpam || message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return false;
  const key = `${message.guild.id}-${message.author.id}`, now = Date.now();
  const t = spamTracker.get(key) ?? { count: 0, first: now, warned: false };
  if (now - t.first > 5000) { t.count = 1; t.first = now; t.warned = false; } else t.count++;
  spamTracker.set(key, t); setTimeout(() => spamTracker.delete(key), 10000);
  if (t.count >= 5) {
    await message.delete().catch(() => {});
    if (!t.warned) { t.warned = true; const w = await message.channel.send(`${message.author}, slow down!`); setTimeout(() => w.delete().catch(() => {}), 4000); try { await message.member?.timeout(60000); } catch {} }
    return true;
  }
  return false;
}
async function handleMediaOnly(message) {
  if (!message.guild) return false;
  const cfg = getConfig(message.guild.id);
  if (!cfg.mediaOnlyChannels.has(message.channelId) || message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return false;
  if (!message.attachments.size && !URL_RE.test(message.content)) {
    await message.delete().catch(() => {});
    const w = await message.channel.send(`${message.author}, media-only channel!`);
    setTimeout(() => w.delete().catch(() => {}), 4000); return true;
  }
  return false;
}
function checkRaidJoin(guildId) {
  const now = Date.now();
  if (!raidTracker.has(guildId)) raidTracker.set(guildId, []);
  const joins = raidTracker.get(guildId);
  joins.push(now); const recent = joins.filter(t => now - t < 10000); joins.length = 0; joins.push(...recent);
  return recent.length >= 5;
}
async function handleSetAntiLink(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.ManageGuild)) return;
  const cfg = getConfig(message.guild.id); const t = args[0]?.toLowerCase();
  if (t === "on") { cfg.antiLink = true; await message.reply("✅ Anti-link enabled."); }
  else if (t === "off") { cfg.antiLink = false; await message.reply("❌ Anti-link disabled."); }
  else await message.reply(`Anti-link is **${cfg.antiLink ? "on" : "off"}**. Use \`+antilink on/off\`.`);
}
async function handleSetAntiSpam(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.ManageGuild)) return;
  const cfg = getConfig(message.guild.id); const t = args[0]?.toLowerCase();
  if (t === "on") { cfg.antiSpam = true; await message.reply("✅ Anti-spam enabled."); }
  else if (t === "off") { cfg.antiSpam = false; await message.reply("❌ Anti-spam disabled."); }
  else await message.reply(`Anti-spam is **${cfg.antiSpam ? "on" : "off"}**. Use \`+antispam on/off\`.`);
}
async function handleSetAntiNuke(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.Administrator)) return;
  const cfg = getConfig(message.guild.id); const t = args[0]?.toLowerCase();
  if (t === "on") { cfg.antiNuke = true; await message.reply("✅ Anti-nuke enabled."); }
  else if (t === "off") { cfg.antiNuke = false; await message.reply("❌ Anti-nuke disabled."); }
  else await message.reply(`Anti-nuke is **${cfg.antiNuke ? "on" : "off"}**. Use \`+antinuke on/off\`.`);
}
async function handleRaidMode(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.Administrator)) return;
  const cfg = getConfig(message.guild.id); const t = args[0]?.toLowerCase();
  if (t === "on") { cfg.raidMode = true; await message.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle("🚨 RAID MODE ON").setDescription("New joins will be auto-kicked!")] }); }
  else if (t === "off") { cfg.raidMode = false; await message.reply("✅ Raid mode disabled."); }
  else await message.reply(`Raid mode is **${cfg.raidMode ? "🔴 ON" : "🟢 OFF"}**.`);
}
async function handleSetMediaOnly(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.ManageChannels)) return;
  const cfg = getConfig(message.guild.id); const t = args[0]?.toLowerCase();
  const chId = message.mentions.channels.first()?.id ?? message.channelId;
  if (t === "add") { cfg.mediaOnlyChannels.add(chId); await message.reply(`✅ <#${chId}> is now media-only.`); }
  else if (t === "remove") { cfg.mediaOnlyChannels.delete(chId); await message.reply(`❌ <#${chId}> no longer media-only.`); }
  else await message.reply("Usage: `+media add [#channel]` or `+media remove [#channel]`");
}

// ─── WELCOME ─────────────────────────────────────────────────────────────────
async function handleWelcomeMember(member) {
  const cfg = getConfig(member.guild.id);
  if (!cfg.welcomeChannelId) return;
  const ch = member.guild.channels.cache.get(cfg.welcomeChannelId);
  if (!ch) return;
  const text = cfg.welcomeMessage.replace("{user}", `<@${member.id}>`).replace("{username}", member.user.username).replace("{server}", member.guild.name).replace("{count}", `${member.guild.memberCount}`);
  await ch.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`Welcome to ${member.guild.name}!`).setDescription(text).setThumbnail(member.user.displayAvatarURL()).setFooter({ text: `Member #${member.guild.memberCount}` }).setTimestamp()] }).catch(() => {});
}
async function handleSetWelcome(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.ManageGuild)) return;
  const cfg = getConfig(message.guild.id); const sub = args[0]?.toLowerCase();
  if (sub === "channel") { const ch = message.mentions.channels.first(); if (!ch) { await message.reply("Mention a channel."); return; } cfg.welcomeChannelId = ch.id; await message.reply(`✅ Welcome channel: <#${ch.id}>`); }
  else if (sub === "message") { const msg = args.slice(1).join(" "); if (!msg) { await message.reply("Provide a message."); return; } cfg.welcomeMessage = msg; await message.reply(`✅ Welcome message set.`); }
  else if (sub === "off") { cfg.welcomeChannelId = null; await message.reply("❌ Welcome disabled."); }
  else if (sub === "test") { if (message.member) await handleWelcomeMember(message.member); await message.reply("✅ Test welcome sent!"); }
  else await message.reply("`+welcome channel #ch` | `+welcome message <text>` | `+welcome test` | `+welcome off`\nVariables: `{user}` `{username}` `{server}` `{count}`");
}

// ─── GIVEAWAY ────────────────────────────────────────────────────────────────
const activeGiveaways = new Map();
const GA_EMOJI = "🎉";
async function endGiveaway(g) {
  g.ended = true; activeGiveaways.delete(g.messageId);
  const ch = _client?.channels.cache.get(g.channelId); if (!ch) return;
  const msg = await ch.messages.fetch(g.messageId).catch(() => null); if (!msg) return;
  const users = await msg.reactions.cache.get(GA_EMOJI)?.users.fetch().catch(() => null);
  const eligible = users?.filter(u => !u.bot).map(u => u.id) ?? [];
  if (!eligible.length) { await msg.edit({ embeds: [EmbedBuilder.from(msg.embeds[0]).setColor(0x747f8d).setTitle("🎊 Ended").setDescription(`**${g.prize}** — No winners.`)] }); await ch.send(`Giveaway for **${g.prize}** ended with no winners.`); return; }
  const winners = []; const pool = [...eligible];
  for (let i = 0; i < Math.min(g.winners, pool.length); i++) { const idx = Math.floor(Math.random() * pool.length); winners.push(pool.splice(idx, 1)[0]); }
  const mentions = winners.map(id => `<@${id}>`).join(", ");
  await msg.edit({ embeds: [EmbedBuilder.from(msg.embeds[0]).setColor(0xffd700).setTitle("🎊 Giveaway Ended!").setDescription(`**Prize:** ${g.prize}\n**Winner(s):** ${mentions}\n**Host:** <@${g.hostId}>`)] });
  await ch.send(`Congratulations ${mentions}! You won **${g.prize}**! 🎉`);
}
function parseGADur(s) { const m = s?.match(/^(\d+)(s|m|h|d)$/); if (!m) return null; return parseInt(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]]; }
async function handleGiveaway(message, args) {
  if (!message.guild) return;
  const sub = args[0]?.toLowerCase();
  if (sub === "start") {
    if (!requirePerm(message, PermissionFlagsBits.ManageGuild)) return;
    const ms = parseGADur(args[1]); const winners = parseInt(args[2]); const prize = args.slice(3).join(" ");
    if (!ms || isNaN(winners) || winners < 1 || !prize) { await message.reply("Usage: `+giveaway start <duration> <winners> <prize>`\nEx: `+giveaway start 1h 1 Nitro`"); return; }
    const endTime = Date.now() + ms;
    const gaMsg = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎉 GIVEAWAY!").setDescription(`**Prize:** ${prize}\n\nReact 🎉 to enter!\n**Ends:** <t:${Math.floor(endTime / 1000)}:R>\n**Winners:** ${winners}\n**Host:** <@${message.author.id}>`).setFooter({ text: "Good luck!" })] });
    await gaMsg.react(GA_EMOJI);
    const g = { messageId: gaMsg.id, channelId: message.channelId, guildId: message.guild.id, prize, winners, hostId: message.author.id, endTime, ended: false };
    activeGiveaways.set(gaMsg.id, g); setTimeout(() => endGiveaway(g), ms);
    await message.reply(`✅ Giveaway started!`);
  } else if (sub === "end") {
    if (!requirePerm(message, PermissionFlagsBits.ManageGuild)) return;
    const g = activeGiveaways.get(args[1]); if (!g) { await message.reply("No active giveaway with that ID."); return; }
    await endGiveaway(g); await message.reply("✅ Ended early!");
  } else if (sub === "reroll") {
    if (!requirePerm(message, PermissionFlagsBits.ManageGuild)) return;
    const msg = await message.channel.messages.fetch(args[1]).catch(() => null); if (!msg) { await message.reply("Message not found."); return; }
    const users = await msg.reactions.cache.get(GA_EMOJI)?.users.fetch().catch(() => null);
    const eligible = users?.filter(u => !u.bot).map(u => u.id) ?? [];
    if (!eligible.length) { await message.reply("No participants."); return; }
    await message.channel.send(`🎉 New winner: <@${eligible[Math.floor(Math.random() * eligible.length)]}>! Congrats!`);
  } else await message.reply("**Giveaway**\n`+giveaway start <dur> <winners> <prize>`\n`+giveaway end <msgId>`\n`+giveaway reroll <msgId>`");
}

// ─── IGNORE ──────────────────────────────────────────────────────────────────
function isIgnored(message) { if (!message.guild) return false; return getConfig(message.guild.id).ignoredChannels.has(message.channelId); }
async function handleIgnore(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.ManageChannels)) return;
  const cfg = getConfig(message.guild.id); const sub = args[0]?.toLowerCase(); const ch = message.mentions.channels.first() ?? message.channel;
  if (sub === "add") { cfg.ignoredChannels.add(ch.id); await message.reply(`✅ Bot ignores <#${ch.id}>.`); }
  else if (sub === "remove") { cfg.ignoredChannels.delete(ch.id); await message.reply(`✅ Bot responds in <#${ch.id}>.`); }
  else if (sub === "list") { await message.reply(cfg.ignoredChannels.size ? `**Ignored:** ${[...cfg.ignoredChannels].map(id => `<#${id}>`).join(", ")}` : "No ignored channels."); }
  else await message.reply("`+ignore add [#ch]` | `+ignore remove [#ch]` | `+ignore list`");
}

// ─── TICKETS ─────────────────────────────────────────────────────────────────
const ticketConfigs = new Map();
function getTC(guildId) { if (!ticketConfigs.has(guildId)) ticketConfigs.set(guildId, { categoryId: null, supportRoleId: null, logChannelId: null, openTickets: new Map() }); return ticketConfigs.get(guildId); }
async function handleTicketButton(interaction) {
  if (!interaction.guild) return;
  const tc = getTC(interaction.guild.id); const member = interaction.member;
  if (tc.openTickets.has(member.id)) { await interaction.reply({ content: `You already have a ticket: <#${tc.openTickets.get(member.id)}>`, ephemeral: true }); return; }
  await interaction.deferReply({ ephemeral: true });
  try {
    const overwrites = [{ id: interaction.guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] }, { id: member.id, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }];
    if (tc.supportRoleId) overwrites.push({ id: tc.supportRoleId, type: OverwriteType.Role, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] });
    const ch = await interaction.guild.channels.create({ name: `ticket-${member.user.username}`, type: ChannelType.GuildText, parent: tc.categoryId ?? undefined, permissionOverwrites: overwrites });
    tc.openTickets.set(member.id, ch.id);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket_close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger).setEmoji("🔒"));
    await ch.send({ content: `<@${member.id}>${tc.supportRoleId ? ` <@&${tc.supportRoleId}>` : ""}`, embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎫 Ticket").setDescription(`Hello <@${member.id}>! Describe your issue. Use \`+ticket close\` to close.`)], components: [row] });
    await interaction.editReply({ content: `✅ Ticket created: <#${ch.id}>` });
    if (tc.logChannelId) interaction.guild.channels.cache.get(tc.logChannelId)?.send(`📋 Ticket opened by <@${member.id}> → <#${ch.id}>`).catch(() => {});
  } catch { await interaction.editReply({ content: "❌ Failed. Check my permissions!" }); }
}
async function handleCloseTicketButton(interaction) {
  if (!interaction.guild) return;
  const ch = interaction.channel; const tc = getTC(interaction.guild.id);
  const userId = [...tc.openTickets.entries()].find(([, id]) => id === ch.id)?.[0];
  if (userId) tc.openTickets.delete(userId);
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("🔒 Closing in 5 seconds...")] });
  setTimeout(() => ch.delete().catch(() => {}), 5000);
  if (tc.logChannelId) interaction.guild.channels.cache.get(tc.logChannelId)?.send(`📋 Ticket closed by <@${interaction.member.id}>`).catch(() => {});
}
async function handleTicket(message, args) {
  if (!message.guild) return;
  const tc = getTC(message.guild.id); const sub = args[0]?.toLowerCase();
  if (sub === "setup") {
    if (!requirePerm(message, PermissionFlagsBits.Administrator)) return;
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket_open").setLabel("Open Ticket").setStyle(ButtonStyle.Primary).setEmoji("🎫"));
    await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎫 Support Tickets").setDescription("Click the button below to open a support ticket.")], components: [row] });
    await message.reply("✅ Ticket panel created!");
  } else if (sub === "close") {
    if (!message.channel.name.startsWith("ticket-")) { await message.reply("Only usable inside a ticket channel."); return; }
    const userId = [...tc.openTickets.entries()].find(([, id]) => id === message.channel.id)?.[0]; if (userId) tc.openTickets.delete(userId);
    await message.reply("🔒 Closing in 5 seconds..."); setTimeout(() => message.channel.delete().catch(() => {}), 5000);
  } else if (sub === "add") {
    const t = message.mentions.members?.first(); if (!t) { await message.reply("Mention a user!"); return; }
    await message.channel.permissionOverwrites.edit(t.id, { ViewChannel: true, SendMessages: true }); await message.reply(`✅ Added <@${t.id}>.`);
  } else if (sub === "remove") {
    const t = message.mentions.members?.first(); if (!t) { await message.reply("Mention a user!"); return; }
    await message.channel.permissionOverwrites.delete(t.id); await message.reply(`✅ Removed <@${t.id}>.`);
  } else if (sub === "category") {
    if (!requirePerm(message, PermissionFlagsBits.Administrator)) return;
    const cat = message.mentions.channels.first(); if (!cat || cat.type !== ChannelType.GuildCategory) { await message.reply("Mention a category channel."); return; }
    tc.categoryId = cat.id; await message.reply(`✅ Ticket category: **${cat.name}**`);
  } else if (sub === "supportrole") {
    if (!requirePerm(message, PermissionFlagsBits.Administrator)) return;
    const role = message.mentions.roles.first(); if (!role) { await message.reply("Mention a role."); return; }
    tc.supportRoleId = role.id; await message.reply(`✅ Support role: **${role.name}**`);
  } else if (sub === "logchannel") {
    if (!requirePerm(message, PermissionFlagsBits.Administrator)) return;
    const ch = message.mentions.channels.first(); if (!ch) { await message.reply("Mention a channel."); return; }
    tc.logChannelId = ch.id; await message.reply(`✅ Ticket logs → <#${ch.id}>`);
  } else await message.reply("`+ticket setup` | `+ticket close` | `+ticket add/remove @user` | `+ticket category` | `+ticket supportrole` | `+ticket logchannel`");
}

// ─── ROLES ───────────────────────────────────────────────────────────────────
async function handleRole(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.ManageRoles) || !message.guild) return;
  const t = message.mentions.members?.first(); if (!t || args.length < 2) { await message.reply("Usage: `+role @user <role name>`"); return; }
  const roleName = args.slice(1).join(" ");
  const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
  if (!role) { await message.reply(`❌ Role **"${roleName}"** not found.`); return; }
  const bot = message.guild.members.me; if (bot && role.position >= bot.roles.highest.position) { await message.reply(`❌ Can't manage **${role.name}** — above my role.`); return; }
  if (t.roles.cache.has(role.id)) { await t.roles.remove(role); await message.reply(`✅ Removed **${role.name}** from **${t.user.username}**.`); }
  else { await t.roles.add(role); await message.reply(`✅ Added **${role.name}** to **${t.user.username}**.`); }
}
async function handleRoles(message) {
  const t = message.mentions.members?.first() ?? message.member; if (!t) return;
  const roles = t.roles.cache.filter(r => r.name !== "@everyone").sort((a, b) => b.position - a.position).map(r => `<@&${r.id}>`).join(", ");
  await message.reply(`**${t.user.username}'s roles:** ${roles || "None"}`);
}

// ─── AFK ─────────────────────────────────────────────────────────────────────
const afkUsers = new Map();
async function handleAfkCheck(message) {
  if (afkUsers.has(message.author.id)) {
    afkUsers.delete(message.author.id);
    const m = await message.reply("👋 Welcome back! AFK removed."); setTimeout(() => m.delete().catch(() => {}), 5000); return;
  }
  for (const u of message.mentions.users.values()) {
    const e = afkUsers.get(u.id); if (!e) continue;
    const mins = Math.floor((Date.now() - e.since) / 60000);
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xffa500).setDescription(`😴 **${u.username}** is AFK: ${e.reason} *(${mins < 1 ? "just now" : `${mins}m ago`})*`)] });
  }
}
async function handleAfk(message, args) {
  afkUsers.set(message.author.id, { reason: args.join(" ") || "AFK", since: Date.now() });
  await message.reply({ embeds: [new EmbedBuilder().setColor(0xffa500).setDescription(`😴 **${message.author.username}** is now AFK: ${args.join(" ") || "AFK"}`)] });
}

// ─── BIRTHDAY ────────────────────────────────────────────────────────────────
const birthdays = new Map();
const bdayChannels = new Map();
const announcedToday = new Set();
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function startBirthdayChecker(client) {
  setInterval(async () => {
    const now = new Date(); const todayKey = `${now.getMonth() + 1}-${now.getDate()}`;
    if (now.getHours() === 0 && now.getMinutes() < 5) announcedToday.clear();
    for (const [, e] of birthdays) {
      if (e.month !== now.getMonth() + 1 || e.day !== now.getDate()) continue;
      const key = `${e.guildId}-${e.userId}-${todayKey}`; if (announcedToday.has(key)) continue;
      const chId = bdayChannels.get(e.guildId); if (!chId) continue;
      const ch = client.channels.cache.get(chId); if (!ch) continue;
      announcedToday.add(key);
      await ch.send({ content: `<@${e.userId}>`, embeds: [new EmbedBuilder().setColor(0xff69b4).setTitle("🎂 Happy Birthday!").setDescription(`It's <@${e.userId}>'s birthday! 🎉 Wish them well!`).setTimestamp()] }).catch(() => {});
    }
  }, 5 * 60 * 1000);
}
async function handleBirthday(message, args) {
  if (!message.guild) return;
  const sub = args[0]?.toLowerCase();
  if (sub === "set") {
    const month = parseInt(args[1]); const day = parseInt(args[2]);
    if (isNaN(month) || month < 1 || month > 12 || isNaN(day) || day < 1 || day > 31) { await message.reply("Usage: `+birthday set <month> <day>`\nEx: `+birthday set 3 15` = March 15"); return; }
    birthdays.set(`${message.guild.id}-${message.author.id}`, { month, day, userId: message.author.id, guildId: message.guild.id });
    await message.reply(`🎂 Birthday set: **${MONTHS[month - 1]} ${day}**!`);
  } else if (sub === "remove") { birthdays.delete(`${message.guild.id}-${message.author.id}`); await message.reply("✅ Birthday removed."); }
  else if (sub === "check") {
    const target = message.mentions.users.first() ?? message.author;
    const e = birthdays.get(`${message.guild.id}-${target.id}`); if (!e) { await message.reply(`**${target.username}** hasn't set their birthday.`); return; }
    const now = new Date(); const next = new Date(now.getFullYear(), e.month - 1, e.day); if (next < now) next.setFullYear(now.getFullYear() + 1);
    const days = Math.ceil((next - now) / 86400000);
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xff69b4).setDescription(`🎂 **${target.username}**: **${MONTHS[e.month - 1]} ${e.day}** *(${days === 0 ? "Today! 🎉" : `${days} day${days === 1 ? "" : "s"} away`})*`)] });
  } else if (sub === "channel") {
    if (!requirePerm(message, PermissionFlagsBits.ManageGuild)) return;
    const ch = message.mentions.channels.first(); if (!ch) { await message.reply("Mention a channel."); return; }
    bdayChannels.set(message.guild.id, ch.id); await message.reply(`✅ Birthday announcements → <#${ch.id}>`);
  } else if (sub === "list") {
    const list = [...birthdays.values()].filter(b => b.guildId === message.guild.id).sort((a, b) => a.month - b.month || a.day - b.day).map(b => `<@${b.userId}> — **${MONTHS[b.month - 1]} ${b.day}**`).join("\n");
    if (!list) { await message.reply("No birthdays set yet."); return; }
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xff69b4).setTitle("🎂 Server Birthdays").setDescription(list)] });
  } else await message.reply("`+birthday set <month> <day>` | `+birthday check [@user]` | `+birthday list` | `+birthday channel #ch` | `+birthday remove`");
}

// ─── AUTO-ROLE ───────────────────────────────────────────────────────────────
const autoRoles = new Map();
async function applyAutoRole(member) {
  const roleId = autoRoles.get(member.guild.id); if (!roleId) return;
  const role = member.guild.roles.cache.get(roleId); if (!role) return;
  await member.roles.add(role, "Auto-role").catch(() => {});
}
async function handleAutoRole(message, args) {
  if (!requirePerm(message, PermissionFlagsBits.ManageRoles) || !message.guild) return;
  const sub = args[0]?.toLowerCase();
  if (sub === "set") {
    const role = message.mentions.roles.first(); if (!role) { await message.reply("Mention a role!"); return; }
    const bot = message.guild.members.me; if (bot && role.position >= bot.roles.highest.position) { await message.reply(`❌ Can't assign **${role.name}** — above my role.`); return; }
    autoRoles.set(message.guild.id, role.id); await message.reply(`✅ New members get **${role.name}**.`);
  } else if (sub === "remove" || sub === "off") { autoRoles.delete(message.guild.id); await message.reply("❌ Auto-role disabled."); }
  else if (sub === "check") { const rId = autoRoles.get(message.guild.id); await message.reply(rId ? `Auto-role: <@&${rId}>` : "No auto-role set."); }
  else await message.reply("`+autorole set @role` | `+autorole remove` | `+autorole check`");
}

// ─── POLL ────────────────────────────────────────────────────────────────────
const NUM_EMOJI = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
async function handlePoll(message, args) {
  if (!args.length) { await message.reply("Usage:\n`+poll <question>` — Yes/No\n`+poll <question> | opt1 | opt2` — Multi-option"); return; }
  const parts = args.join(" ").split("|").map(p => p.trim()); const question = parts[0];
  await message.delete().catch(() => {});
  if (parts.length === 1) {
    const m = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📊 Poll").setDescription(`**${question}**`).setFooter({ text: `Poll by ${message.author.tag}` }).setTimestamp()] });
    await m.react("✅"); await m.react("❌");
  } else {
    const options = parts.slice(1); if (options.length < 2 || options.length > 10) { await message.channel.send("2–10 options required."); return; }
    const m = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📊 Poll").setDescription(`**${question}**\n\n${options.map((o, i) => `${NUM_EMOJI[i]} ${o}`).join("\n")}`).setFooter({ text: `Poll by ${message.author.tag}` }).setTimestamp()] });
    for (let i = 0; i < options.length; i++) await m.react(NUM_EMOJI[i]);
  }
}

// ─── UTILITY ─────────────────────────────────────────────────────────────────
const customCmds = new Map();
async function handleHelp(message) {
  await message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📖 Bot Commands").setDescription("All commands (prefix: `+`)")
    .addFields(
      { name: "🤖 AI", value: "`+ask <q>` `+clearchat`" },
      { name: "🎮 Games", value: "`+trivia` `+roll` `+flip` `+8ball <q>` `+rps <choice>` `+guess`" },
      { name: "🔨 Mod", value: "`+kick` `+ban` `+unban` `+mute` `+unmute` `+purge` `+warn` `+lock` `+unlock` `+snipe` `+tempban @u <dur>`" },
      { name: "🛡️ Auto-Mod", value: "`+antilink on/off` `+antispam on/off` `+antinuke on/off` `+raidmode on/off` `+media add/remove`" },
      { name: "🎉 Giveaway", value: "`+giveaway start <dur> <winners> <prize>` `+giveaway end/reroll <msgId>`" },
      { name: "👋 Welcome", value: "`+welcome channel #ch` `+welcome message <text>` `+welcome test` `+welcome off`" },
      { name: "😴 AFK", value: "`+afk [reason]` — auto removed when you talk" },
      { name: "🎂 Birthday", value: "`+birthday set <m> <d>` `+birthday check` `+birthday list` `+birthday channel #ch`" },
      { name: "📊 Poll", value: "`+poll <q>` — Yes/No | `+poll <q> | opt1 | opt2` — Multi" },
      { name: "⏱️ Tempban", value: "`+tempban @u <dur> [reason]` — `30m` `1h` `2d` `1w`" },
      { name: "✅ Auto-role", value: "`+autorole set @role` `+autorole remove` `+autorole check`" },
      { name: "🎫 Tickets", value: "`+ticket setup/close/add/remove/category/supportrole/logchannel`" },
      { name: "🏷️ Roles", value: "`+role @u <name>` — toggle | `+roles [@u]` — list" },
      { name: "⚙️ Utility", value: "`+ping` `+serverinfo` `+userinfo` `+avatar` `+ignore add/remove/list` `+addcmd` `+delcmd` `+listcmds`" },
    ).setFooter({ text: "Prefix: +" })] });
}
async function handlePing(message) { const s = await message.reply("Pinging..."); await s.edit(`Pong! **${s.createdTimestamp - message.createdTimestamp}ms**`); }
async function handleServerInfo(message) {
  const g = message.guild; if (!g) return;
  await message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(g.name).setThumbnail(g.iconURL()).addFields(
    { name: "Owner", value: `<@${g.ownerId}>`, inline: true }, { name: "Members", value: `${g.memberCount}`, inline: true },
    { name: "Channels", value: `${g.channels.cache.size}`, inline: true }, { name: "Roles", value: `${g.roles.cache.size}`, inline: true },
    { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true }, { name: "Boost Level", value: `${g.premiumTier}`, inline: true },
  )] });
}
async function handleUserInfo(message) {
  const target = message.mentions.users.first() ?? message.author;
  const member = message.guild?.members.cache.get(target.id);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(target.username).setThumbnail(target.displayAvatarURL())
    .addFields({ name: "ID", value: target.id, inline: true }, { name: "Created", value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true });
  if (member) embed.addFields({ name: "Joined", value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true }, { name: "Nickname", value: member.nickname ?? "None", inline: true });
  await message.reply({ embeds: [embed] });
}
async function handleAvatar(message) {
  const t = message.mentions.users.first() ?? message.author;
  await message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`${t.username}'s Avatar`).setImage(t.displayAvatarURL({ size: 512 }))] });
}
async function handleAddCmd(message, args) {
  if (!message.member?.permissions.has(8n)) { await message.reply("Need Administrator."); return; }
  if (args.length < 2) { await message.reply("Usage: `+addcmd <name> <response>`"); return; }
  customCmds.set(args[0].toLowerCase(), args.slice(1).join(" ")); await message.reply(`✅ Command \`+${args[0].toLowerCase()}\` added!`);
}
async function handleDelCmd(message, args) {
  if (!message.member?.permissions.has(8n)) { await message.reply("Need Administrator."); return; }
  const name = args[0]?.toLowerCase(); if (!name || !customCmds.has(name)) { await message.reply("Command not found."); return; }
  customCmds.delete(name); await message.reply(`✅ Command \`+${name}\` deleted.`);
}
async function handleListCmds(message) { await message.reply(customCmds.size ? `**Custom cmds:** ${[...customCmds.keys()].map(k => `\`+${k}\``).join(", ")}` : "No custom commands yet."); }

// ─── START BOT ───────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessageReactions,
  ],
});

_client = client;

client.once(Events.ClientReady, c => {
  console.log(`✅ Bot online: ${c.user.tag}`);
  c.user.setActivity("+help for commands");
  startBirthdayChecker(c);
});

client.on(Events.MessageDelete, message => {
  if (!message.partial && !message.author?.bot) cacheDeletedMessage(message);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId === "ticket_open") await handleTicketButton(interaction);
  else if (interaction.customId === "ticket_close") await handleCloseTicketButton(interaction);
});

client.on(Events.GuildMemberAdd, async member => {
  if (getConfig(member.guild.id).raidMode && checkRaidJoin(member.guild.id)) { await member.kick("Raid mode").catch(() => {}); return; }
  await applyAutoRole(member);
  await handleWelcomeMember(member);
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;
  if (isIgnored(message)) return;

  if (!message.content.startsWith(PREFIX)) {
    if (await handleAntiLink(message)) return;
    if (await handleAntiSpam(message)) return;
    await handleMediaOnly(message);
    checkTriviaAnswer(message);
    await handleAfkCheck(message);
    return;
  }

  if (await handleAntiLink(message)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  if (!command) return;

  try {
    switch (command) {
      case "help": await handleHelp(message); break;
      case "ping": await handlePing(message); break;
      case "serverinfo": await handleServerInfo(message); break;
      case "userinfo": await handleUserInfo(message); break;
      case "avatar": await handleAvatar(message); break;
      case "addcmd": await handleAddCmd(message, args); break;
      case "delcmd": await handleDelCmd(message, args); break;
      case "listcmds": await handleListCmds(message); break;
      case "ask": await handleAsk(message, args); break;
      case "clearchat": await handleClearChat(message); break;
      case "trivia": await handleTrivia(message); break;
      case "roll": await handleRoll(message, args); break;
      case "flip": await handleCoinflip(message); break;
      case "8ball": await handle8Ball(message, args); break;
      case "rps": await handleRps(message, args); break;
      case "guess": await handleGuess(message); break;
      case "kick": await handleKick(message, args); break;
      case "ban": await handleBan(message, args); break;
      case "unban": await handleUnban(message, args); break;
      case "mute": await handleMute(message, args); break;
      case "unmute": await handleUnmute(message); break;
      case "purge": await handlePurge(message, args); break;
      case "warn": await handleWarn(message, args); break;
      case "lock": await handleLock(message, args); break;
      case "unlock": await handleUnlock(message, args); break;
      case "snipe": await handleSnipe(message); break;
      case "antilink": await handleSetAntiLink(message, args); break;
      case "antispam": await handleSetAntiSpam(message, args); break;
      case "antinuke": await handleSetAntiNuke(message, args); break;
      case "raidmode": await handleRaidMode(message, args); break;
      case "media": await handleSetMediaOnly(message, args); break;
      case "welcome": await handleSetWelcome(message, args); break;
      case "giveaway": case "g": await handleGiveaway(message, args); break;
      case "ignore": await handleIgnore(message, args); break;
      case "ticket": case "tickets": await handleTicket(message, args); break;
      case "role": await handleRole(message, args); break;
      case "roles": await handleRoles(message); break;
      case "afk": await handleAfk(message, args); break;
      case "birthday": case "bday": await handleBirthday(message, args); break;
      case "autorole": await handleAutoRole(message, args); break;
      case "tempban": case "tban": await handleTempban(message, args); break;
      case "poll": await handlePoll(message, args); break;
      default: { const r = customCmds.get(command); if (r) await message.reply(r); break; }
    }
  } catch (err) {
    console.error(`Error in +${command}:`, err);
    await message.reply("An error occurred. Try again!").catch(() => {});
  }
});

client.login(TOKEN);
