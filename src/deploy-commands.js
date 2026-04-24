import { REST, Routes } from 'discord.js';
import 'dotenv/config';
import { data as rankingData } from './commands/ranking.js';
import { data as mystatsData } from './commands/mystats.js';
import { data as buddiesData } from './commands/buddies.js';
import { data as optoutData }  from './commands/optout.js';
import { data as setupData }   from './commands/setup.js';

const rest     = new REST().setToken(process.env.DISCORD_TOKEN);
const commands = [rankingData, mystatsData, buddiesData, optoutData, setupData].map(d => d.toJSON());

// DEV_GUILD_ID registers commands to a single guild for instant propagation
// during development. Without it, commands register globally (up to 1h to appear,
// but available in every guild the bot joins).
const devGuild = process.env.DEV_GUILD_ID;

const route = devGuild
  ? Routes.applicationGuildCommands(process.env.CLIENT_ID, devGuild)
  : Routes.applicationCommands(process.env.CLIENT_ID);

console.log(`Registering ${commands.length} commands ${devGuild ? `to dev guild ${devGuild}` : 'globally'}...`);

await rest.put(route, { body: commands });

console.log('Commands registered.');
