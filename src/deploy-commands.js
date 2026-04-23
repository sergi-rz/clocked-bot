import { REST, Routes } from 'discord.js';
import 'dotenv/config';
import { data as rankingData } from './commands/ranking.js';
import { data as mystatsData } from './commands/mystats.js';
import { data as buddiesData } from './commands/buddies.js';
import { data as optoutData }  from './commands/optout.js';

const rest     = new REST().setToken(process.env.DISCORD_TOKEN);
const commands = [rankingData, mystatsData, buddiesData, optoutData].map(d => d.toJSON());

console.log(`Registering ${commands.length} commands...`);

await rest.put(
  Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
  { body: commands }
);

console.log('Commands registered.');
