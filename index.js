import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder
} from "discord.js";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { createCanvas, loadImage, registerFont } from "canvas";
import path from "path";
import fs from "fs";
import http from "http";

dotenv.config();

/* ------------------- Font Registration ------------------- */
const fontPath = path.resolve("./Minecraft.ttf");
if (!fs.existsSync(fontPath)) {
  console.error(`Font not found: ${fontPath}`);
  process.exit(1);
}
registerFont(fontPath, { family: "Minecraftia" });

/* ------------------- Discord Client Setup ------------------- */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const GAME_STAT_MAP = {
  bedwars: "wins:bedwars:global:lifetime",
  skywars: "wins:skywars:global:lifetime",
  bridges: "wins:bridges:global:lifetime",
  stickfight: "wins:stickfight:global:lifetime",
  sumo: "wins:sumo:global:lifetime",
  builduhc: "wins:builduhc:global:lifetime",
  bedfight: "wins:bedfight:global:lifetime",
  boxing: "wins:boxing:global:lifetime",
  nodebuff: "wins:nodebuff:global:lifetime",
  pearl: "wins:pearl:global:lifetime",
  soup: "wins:soup:global:lifetime",
  spleef: "wins:spleef:global:lifetime",
  gapple: "wins:gapple:global:lifetime",
  "combo": "wins:combo:global:lifetime"
};

const commands = [
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Get ArchMC stats for a player")
    .addStringOption(opt =>
      opt
        .setName("player")
        .setDescription("Minecraft username")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Get ArchMC leaderboard for a game")
    .addStringOption(opt =>
      opt
        .setName("game")
        .setDescription("Game name (e.g., Bedwars, SkyWars, Bridges)")
        .setRequired(true)
        .addChoices(
          { name: "Bedwars", value: "bedwars" },
          { name: "SkyWars", value: "skywars" },
          { name: "Bridges", value: "bridges" },
          { name: "Stickfight", value: "stickfight" },
          { name: "Sumo", value: "sumo" },
          { name: "BuildUHC", value: "builduhc" },
          { name: "Bedfight", value: "bedfight" },
          { name: "Boxing", value: "boxing" },
          { name: "NoDebuff", value: "nodebuff" },
          { name: "Pearl", value: "pearl" },
          { name: "Soup", value: "soup" },
          { name: "Spleef", value: "spleef" },
          { name: "Gapple", value: "gapple" },
          { name: "Combo", value: "combo" }
        )
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("Commands registered");
  } catch (err) {
    console.error("Failed to register commands:", err.message);
  }
})();

/* ------------------- Cache Management ------------------- */
const cache = {};
const CACHE_TTL = 2 * 60 * 1000;

function getCached(key) {
  const entry = cache[key];
  if (entry && Date.now() < entry.expires) return entry.data;
  delete cache[key];
  return null;
}

function setCache(key, data) {
  cache[key] = { data, expires: Date.now() + CACHE_TTL };
}

/* ------------------- API Functions ------------------- */
async function fetchFromArch(endpoint) {
  const cached = getCached(endpoint);
  if (cached) return cached;

  const url = `${process.env.API_BASE}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      headers: { "X-API-KEY": process.env.API_KEY },
      signal: controller.signal
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "unknown error");
      throw new Error(`API ${res.status}: ${errorText.substring(0, 50)}`);
    }

    const data = await res.json();
    setCache(endpoint, data);
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getPlayerStats(username) {
  return fetchFromArch(`/players/username/${username}/statistics`);
}

async function getLeaderboard(statId, page = 0, size = 10) {
  return fetchFromArch(`/leaderboards/${statId}?page=${page}&size=${size}`);
}

async function getMinecraftSkin(username) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const uuidRes = await fetch(
        `https://api.mojang.com/users/profiles/minecraft/${username}`,
        { signal: controller.signal }
      );
      if (!uuidRes.ok) throw new Error("Not found");

      const { id: uuid } = await uuidRes.json();

      const profileRes = await fetch(
        `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`,
        { signal: controller.signal }
      );
      if (!profileRes.ok) throw new Error("No profile");

      const { properties } = await profileRes.json();
      const texture = properties.find(p => p.name === "textures");
      if (!texture) throw new Error("No texture");

      const decoded = JSON.parse(Buffer.from(texture.value, "base64").toString());
      return decoded.textures.SKIN.url;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    return path.resolve("./steve.jpg");
  }
}

/* ------------------- Text Drawing ------------------- */
function drawText(ctx, text, x, y, size, color = "#ffffff") {
  ctx.font = `${size}px Minecraftia`;
  ctx.fillStyle = "#000000";
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawBox(ctx, x, y, w, h, color = "#1a1a1a", alpha = 0.7) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
}

function drawBar(ctx, x, y, w, h, value, maxValue = 100, color = "#4ecdc4") {
  const barWidth = (value / maxValue) * w;
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.min(barWidth, w), h);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.globalAlpha = 1;
}

/* ------------------- Stat Helpers ------------------- */
function getStat(stats, key) {
  const stat = stats[key];
  if (stat && typeof stat === "object") {
    return {
      value: stat.value || 0,
      percentile: stat.percentile || 0,
      position: stat.position || 0,
      totalPlayers: stat.totalPlayers || 0
    };
  }
  return { value: 0, percentile: 0, position: 0, totalPlayers: 0 };
}

const STAT_DISPLAYS = [
  { label: "Stickfight", stat: "wins:stickfight:global:lifetime", color: "#ff6b6b" },
  { label: "Sumo", stat: "wins:sumo:global:lifetime", color: "#4ecdc4" },
  { label: "BuildUHC", stat: "wins:builduhc:global:lifetime", color: "#45b7d1" },
  { label: "SkyWars", stat: "wins:skywars:global:lifetime", color: "#96ceb4" },
  { label: "Bridges", stat: "wins:bridges:global:lifetime", color: "#ffeaa7" },
  { label: "Bedfight", stat: "wins:bedfight:global:lifetime", color: "#dfe6e9" }
];

/* ------------------- Leaderboard Image Generation ------------------- */
async function generateLeaderboardImage(gameName, leaderboardData) {
  const width = 900;
  const height = 800;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  /* ---- Background ---- */
  const bgPath = path.resolve("./background.png");
  if (fs.existsSync(bgPath)) {
    try {
      const bg = await loadImage(bgPath);
      const scale = Math.max(width / bg.width, height / bg.height);
      const sw = width / scale;
      const sh = height / scale;
      const sx = (bg.width - sw) / 2;
      const sy = (bg.height - sh) / 2;
      ctx.drawImage(bg, sx, sy, sw, sh, 0, 0, width, height);
    } catch (err) {
      ctx.fillStyle = "#0a0e27";
      ctx.fillRect(0, 0, width, height);
    }
  } else {
    ctx.fillStyle = "#0a0e27";
    ctx.fillRect(0, 0, width, height);
  }

  /* ---- Dark overlay ---- */
  drawBox(ctx, 0, 0, width, height, "#000000", 0.35);

  /* ---- Header section ---- */
  drawBox(ctx, 0, 0, width, 80, "#1a1a2e", 0.8);
  drawText(ctx, `${gameName} Leaderboard`, 30, 60, 36, "#4ecdc4");

  /* ---- Column headers ---- */
  const headerY = 100;
  drawBox(ctx, 15, headerY, width - 30, 40, "#16213e", 0.7);
  
  drawText(ctx, "Rank", 35, headerY + 28, 16, "#aaffaa");
  drawText(ctx, "Player", 120, headerY + 28, 16, "#aaffaa");
  drawText(ctx, "Wins", 700, headerY + 28, 16, "#aaffaa");

  /* ---- Leaderboard entries ---- */
  if (!leaderboardData || !leaderboardData.entries || leaderboardData.entries.length === 0) {
    drawText(ctx, "No leaderboard data found", 30, 250, 24, "#ff6b6b");
    return canvas.toBuffer("image/png");
  }

  const rowHeight = 60;
  let y = headerY + 50;

  for (let i = 0; i < leaderboardData.entries.length; i++) {
    const entry = leaderboardData.entries[i];
    const isEven = i % 2 === 0;
    
    /* ---- Row background ---- */
    if (isEven) {
      drawBox(ctx, 15, y - 5, width - 30, rowHeight - 5, "#0f3460", 0.3);
    }

    /* ---- Rank (colored by position) ---- */
    let rankColor = "#4ecdc4";
    if (entry.position === 1) rankColor = "#ffd700"; // Gold
    else if (entry.position === 2) rankColor = "#c0c0c0"; // Silver
    else if (entry.position === 3) rankColor = "#cd7f32"; // Bronze
    else rankColor = "#aaffaa";

    drawText(ctx, `#${entry.position}`, 35, y + 20, 18, rankColor);

    /* ---- Player name ---- */
    const playerName = (entry.username || "Unknown").substring(0, 20);
    drawText(ctx, playerName, 120, y + 20, 18, "#ffffff");

    /* ---- Wins value ---- */
    drawText(ctx, entry.value.toString(), 700, y + 20, 18, "#96ceb4");

    /* ---- Bar for wins ---- */
    const maxWins = leaderboardData.entries[0]?.value || 100;
    const barWidth = (entry.value / maxWins) * 150;
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = rankColor;
    ctx.fillRect(760, y + 5, barWidth, 28);
    ctx.globalAlpha = 1;

    y += rowHeight;
  }

  /* ---- Footer ---- */
  drawBox(ctx, 0, height - 40, width, 40, "#0f3460", 0.6);
  const totalPlayers = leaderboardData.totalPlayers || 0;
  drawText(ctx, `Total Players: ${totalPlayers.toLocaleString()}  Made by KessudMC `, 30, height - 15, 14, "#888888");

  return canvas.toBuffer("image/png");
}

/* ------------------- Image Generation ------------------- */
async function generateStatsImage(username, playerData, skinURL) {
  const width = 1000;
  const height = 750;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  /* ---- Background ---- */
  const bgPath = path.resolve("./background.png");
  if (fs.existsSync(bgPath)) {
    try {
      const bg = await loadImage(bgPath);
      const scale = Math.max(width / bg.width, height / bg.height);
      const sw = width / scale;
      const sh = height / scale;
      const sx = (bg.width - sw) / 2;
      const sy = (bg.height - sh) / 2;
      ctx.drawImage(bg, sx, sy, sw, sh, 0, 0, width, height);
    } catch (err) {
      ctx.fillStyle = "#0a0e27";
      ctx.fillRect(0, 0, width, height);
    }
  } else {
    ctx.fillStyle = "#0a0e27";
    ctx.fillRect(0, 0, width, height);
  }

  /* ---- Dark overlay ---- */
  drawBox(ctx, 0, 0, width, height, "#000000", 0.35);

  /* ---- Header section ---- */
  drawBox(ctx, 0, 0, width, 100, "#1a1a2e", 0.8);

  /* ---- Player head ---- */
  try {
    const skin = await loadImage(skinURL);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(skin, 8, 8, 8, 8, 15, 12, 75, 75);
  } catch (err) {
    ctx.fillStyle = "#666666";
    ctx.fillRect(15, 12, 75, 75);
  }

  /* ---- Username ---- */
  drawText(ctx, username, 105, 65, 34, "#ffffff");

  const stats = playerData.statistics || {};
  console.log("Available stats:", Object.keys(stats).filter(k => k.includes("bedwars")).slice(0, 10));

  /* ================= BEDWARS SECTION ================= */
  const bedwarsY = 120;
  drawBox(ctx, 15, bedwarsY, 450, 300, "#16213e", 0.7);

  /* Bedwars Header */
  drawText(ctx, "BEDWARS", 30, bedwarsY + 25, 22, "#ff6b6b");

  const bedwarsStats = {
    wins: getStat(stats, "wins:bedwars:global:lifetime"),
    kills: getStat(stats, "kills:bedwars:global:lifetime"),
    deaths: getStat(stats, "deaths:bedwars:global:lifetime"),
    finalKills: getStat(stats, "final_kills:bedwars:global:lifetime")
  };

  let bwy = bedwarsY + 55;
  const bedwarsLineHeight = 45;

  /* Wins */
  drawBox(ctx, 25, bwy, 420, 38, "#0f3460", 0.5);
  drawText(ctx, "Wins", 35, bwy + 25, 16, "#ffffff");
  drawText(ctx, bedwarsStats.wins.value.toString(), 150, bwy + 25, 18, "#4ecdc4");
  drawBar(ctx, 230, bwy + 10, 195, 18, bedwarsStats.wins.value, 300, "#4ecdc4");
  bwy += bedwarsLineHeight;

  /* Kills */
  drawBox(ctx, 25, bwy, 420, 38, "#0f3460", 0.5);
  drawText(ctx, "Kills", 35, bwy + 25, 16, "#ffffff");
  drawText(ctx, bedwarsStats.kills.value.toString(), 150, bwy + 25, 18, "#96ceb4");
  drawBar(ctx, 230, bwy + 10, 195, 18, bedwarsStats.kills.value, 500, "#96ceb4");
  bwy += bedwarsLineHeight;

  /* Deaths */
  drawBox(ctx, 25, bwy, 420, 38, "#0f3460", 0.5);
  drawText(ctx, "Deaths", 35, bwy + 25, 16, "#ffffff");
  drawText(ctx, bedwarsStats.deaths.value.toString(), 150, bwy + 25, 18, "#ff6b6b");
  drawBar(ctx, 230, bwy + 10, 195, 18, bedwarsStats.deaths.value, 300, "#ff6b6b");
  bwy += bedwarsLineHeight;

  /* Final Kills */
  drawBox(ctx, 25, bwy, 420, 38, "#0f3460", 0.5);
  drawText(ctx, "Final Kills", 35, bwy + 25, 16, "#ffffff");
  drawText(ctx, bedwarsStats.finalKills.value.toString(), 150, bwy + 25, 18, "#a29bfe");
  drawBar(ctx, 230, bwy + 10, 195, 18, bedwarsStats.finalKills.value, 500, "#a29bfe");

  /* ================= OTHER GAMES SECTION ================= */
  const gamesY = 120;
  drawBox(ctx, 480, gamesY, 505, 300, "#16213e", 0.7);

  drawText(ctx, "OTHER GAMES", 495, gamesY + 25, 20, "#96ceb4");

  let gy = gamesY + 55;
  const gameLineHeight = 42;

  for (const display of STAT_DISPLAYS) {
    const stat = getStat(stats, display.stat);

    drawBox(ctx, 490, gy, 485, 35, "#0f3460", 0.5);
    drawText(ctx, display.label, 505, gy + 23, 15, "#ffffff");
    drawText(ctx, stat.value.toString(), 700, gy + 23, 15, display.color);
    const percentile = (stat.percentile * 100).toFixed(1);
    drawText(ctx, `${percentile}%`, 760, gy + 23, 13, "#aaffaa");

    drawBar(ctx, 820, gy + 8, 155, 19, stat.value, 150, display.color);

    gy += gameLineHeight;
  }

  /* ================= FOOTER ================= */
  drawBox(ctx, 0, height - 50, width, 50, "#0f3460", 0.6);
  drawText(ctx, "ArchStats  Made by KessudMC", 20, height - 20, 14, "#888888");

  return canvas.toBuffer("image/png");
}

/* ------------------- Discord Bot ------------------- */
client.once("ready", () => {
  console.log(`✓ Bot logged in as ${client.user.tag}`);
});

client.on("error", err => {
  console.error("Discord client error:", err);
});

process.on("unhandledRejection", err => {
  console.error("Unhandled rejection:", err);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "stats") {
    handleStatsCommand(interaction);
  } else if (interaction.commandName === "leaderboard") {
    handleLeaderboardCommand(interaction);
  }
});

async function handleStatsCommand(interaction) {
  const username = interaction.options.getString("player");

  if (!username || username.length > 16 || username.length < 3) {
    await interaction.reply("Username must be 3-16 characters.");
    return;
  }

  try {
    await interaction.deferReply();

    const [playerData, skinURL] = await Promise.all([
      getPlayerStats(username),
      getMinecraftSkin(username)
    ]);

    if (!playerData || !playerData.statistics || Object.keys(playerData.statistics).length === 0) {
      await interaction.editReply(`No stats found for **${username}**.`);
      return;
    }

    const buffer = await generateStatsImage(username, playerData, skinURL);
    const attachment = new AttachmentBuilder(buffer, { name: "stats.png" });
    await interaction.editReply({ files: [attachment] });
  } catch (err) {
    console.error(`Stats error for ${username}: ${err.message}`);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`Error: ${err.message.substring(0, 80)}`);
      } else {
        await interaction.reply(`Error: ${err.message.substring(0, 80)}`);
      }
    } catch (replyErr) {
      console.error(`Reply error: ${replyErr.message}`);
    }
  }
}

async function handleLeaderboardCommand(interaction) {
  const game = interaction.options.getString("game");

  if (!GAME_STAT_MAP[game]) {
    await interaction.reply(`Unknown game: ${game}`);
    return;
  }

  try {
    await interaction.deferReply();

    const statId = GAME_STAT_MAP[game];
    const leaderboardData = await getLeaderboard(statId, 0, 10);

    if (!leaderboardData || !leaderboardData.entries) {
      await interaction.editReply(`No leaderboard data found for **${game}**.`);
      return;
    }

    const gameName = game.charAt(0).toUpperCase() + game.slice(1);
    const buffer = await generateLeaderboardImage(gameName, leaderboardData);
    const attachment = new AttachmentBuilder(buffer, { name: "leaderboard.png" });

    await interaction.editReply({ files: [attachment] });
  } catch (err) {
    console.error(`Leaderboard error for ${game}: ${err.message}`);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`Error: ${err.message.substring(0, 80)}`);
      } else {
        await interaction.reply(`Error: ${err.message.substring(0, 80)}`);
      }
    } catch (replyErr) {
      console.error(`Reply error: ${replyErr.message}`);
    }
  }
}


/* ------------------- Server Setup ------------------- */
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  
  if (!process.env.BOT_TOKEN) {
    console.error("❌ BOT_TOKEN environment variable not set");
    process.exit(1);
  }
  
  console.log("Attempting to login Discord bot...");
  client.login(process.env.BOT_TOKEN).catch(err => {
    console.error("Failed to login:", err.message);
    process.exit(1);
  });
});
