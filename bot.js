const { readFile, writeFile, access } = require('fs').promises;
const { Client, Enums } = require('fnbr');
const { Client: DiscordClient, GatewayIntentBits, REST, Routes } = require('discord.js');

let otps = {};
const linkedFile = './linked.json';
let linkedData = {};

async function loadLinkedData() {
  try {
    linkedData = JSON.parse(await readFile(linkedFile));
  } catch {
    linkedData = {};
    await saveLinkedData();
  }
}

async function saveLinkedData() {
  await writeFile(linkedFile, JSON.stringify(linkedData, null, 2));
}

async function genOTP() {
  return ('' + Math.floor(Math.random() * 10000)).padStart(4, '0');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  const config = JSON.parse(await readFile('./config.json'));

  await loadLinkedData();

  let auth;
  try {
    auth = { 
      deviceAuth: config.deviceAuths, 
      authClient: 'fortniteAndroidGameClient' 
    };
  } catch (e) {
    auth = { 
      authorizationCode: async () => Client.consoleQuestion('Please enter an authorization code: '), 
      authClient: 'fortniteAndroidGameClient' 
    };
  }

  const fnClient = new Client({ auth });

  fnClient.on('deviceauth:created', (da) => {
    writeFile('./config.json', JSON.stringify({ 
      ...config, 
      deviceAuths: da 
    }, null, 2));
  });

  fnClient.on('ready', () => {
    console.log(`FNBR Client online: ${fnClient.user.self.displayName}`);
    fnClient.party.setPrivacy(Enums.PartyPrivacy.PRIVATE);
    fnClient.setStatus("⏰ Loading.", "online");
  });

  fnClient.on('friend:request', async (request) => {
    await request.accept();
    const otp = await genOTP();
    otps[request.id] = { otp, createdAt: Date.now() };

    await sleep(800);

    fnClient.setStatus(`🔒 OTP: ${otp}`, "online", `${request.id}`);
    console.log(`Generated OTP for ${request.id}: ${otp}`);

    setTimeout(async () => {
      if (otps[request.id]) {
        delete otps[request.id];
        console.log(`OTP for ${request.id} has expired.`);
        await fnClient.friend.remove(request.id);
        console.log(`Removed friend ${request.id} after OTP expired.`);
      }
    }, 5 * 60 * 1000);
  });

  fnClient.on('party:invite', async (invite) => {
    await invite.decline();
  });

  await fnClient.login();

  const discordClient = new DiscordClient({ intents: [GatewayIntentBits.Guilds] });

  const commands = [
    {
      name: 'link',
      description: 'Link your Fortnite account using an OTP.',
      options: [
        {
          name: 'otp',
          description: 'The OTP code provided by the bot.',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'unlink',
      description: 'Unlink your Fortnite account.',
    },
  ];

  const rest = new REST({ version: '10' }).setToken(config.token);

  (async () => {
    try {
      console.log('Started refreshing application (/) commands.');
      await rest.put(
        Routes.applicationCommands(config.appId),
        { body: commands }
      );
      console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
      console.error(error);
    }
  })();

  discordClient.on('ready', () => {
    console.log(`Discord Bot online: ${discordClient.user.tag}`);
  });

  discordClient.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options, user } = interaction;

    if (commandName === 'link') {
      const otp = options.getString('otp');
      const fnId = Object.keys(otps).find(id => otps[id].otp === otp);

      if (!fnId) {
        await interaction.reply({ content: 'Invalid or expired OTP. Please try again.', ephemeral: true });
        return;
      }

      const friend = fnClient.friend.list.get(fnId);
      linkedData[user.id] = {
        dsId: user.id,
        dsN: user.displayName || "Unknown",
        fnN: friend ? friend.displayName : 'Unknown',
        fnId: fnId,
        fnLD: new Date().toISOString(),
      };

      delete otps[fnId];
      await saveLinkedData();
      await interaction.reply({ content: 'Your Fortnite account has been linked successfully!', ephemeral: true });

      await fnClient.friend.remove(fnId);
    }

    if (commandName === 'unlink') {
      if (!linkedData[user.id]) {
        await interaction.reply({ content: 'No linked account found.', ephemeral: true });
        return;
      }

      delete linkedData[user.id];
      await saveLinkedData();
      await interaction.reply({ content: 'Your Fortnite account has been unlinked successfully!', ephemeral: true });
    }
  });

  discordClient.login(config.token);
})();
