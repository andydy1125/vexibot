const Discord = require('discord.js');
const he = require('he');

const app = require('./app');
const dbinfo = require('./dbinfo');

const db = app.db;
const client = app.client;
const decodeProgram = dbinfo.decodeProgram;
const decodeSeason = dbinfo.decodeSeason;
const decodeSeasonUrl = dbinfo.decodeSeasonUrl;
const decodeGrade = dbinfo.decodeGrade;
const decodeRound = dbinfo.decodeRound;
const decodeSkill = dbinfo.decodeSkill;

const getTeamId = (message, args) => {
	const arg = args.replace(/\s+/g, '');
	if (arg) {
		return arg.toUpperCase();
	}
	return (message.member ? message.member.displayName : message.author.username).split(' | ', 2)[1];
};

const validTeamId = teamId => /^([0-9]{1,5}[A-Z]?|[A-Z]{2,6}[0-9]{0,2})$/i.test(teamId);

const getTeam = teamId => db.collection('teams').find({prog: (isNaN(teamId.charAt(0)) ? 4 : 1), '_id.id': new RegExp(`^${teamId}$`, 'i')}).sort({'_id.season': -1}).toArray();

const getTeamLocation = team => {
	let location = [team.city];
	if (team.region) {
		location.push(team.region);
	}
	if (team.country) {
		location.push(team.country);
	}
	return location.join(', ');
};

const createTeamEmbed = team => {
	const teamId = team._id.id;
	const season = team._id.season;
	const location = getTeamLocation(team);
	const embed = new Discord.RichEmbed()
		.setColor('GREEN')
		.setAuthor(teamId, null, `https://vexdb.io/teams/view/${teamId}`)
		.setTitle(`${decodeProgram(team.prog)} ${decodeSeason(season)}`)
		.setURL(decodeSeasonUrl(season));
	if (team.name.trim()) {
		embed.addField('Team Name', he.decode(team.name), true);
	}
	if (team.robot.trim()) {
		embed.addField('Robot Name', he.decode(team.robot), true);
	}
	if (team.org.trim()) {
		embed.addField('Organization', he.decode(team.org), true);
	}
	if (location) {
		embed.addField('Location', location, true);
	}
	if (team.grade) {
		embed.addField('Grade', decodeGrade(team.grade), true);
	}
	return embed;
};

const maskedTeamUrl = teamId => `[${teamId}](https://vexdb.io/teams/view/${teamId})`;

const createMatchString = (round, instance, number) => `${decodeRound(round)}${round < 3 ? '' : ` ${instance}-`}${number}`;

const createTeamsString = (teams, teamSit) => {
	teams = teams.filter(team => team);
	return teams.map(team => (teams.length > 2 && team === teamSit) ? `*${maskedTeamUrl(team)}*` : `**${maskedTeamUrl(team)}**`).join(' ');
};

const matchScheduledEmojis = ['🔴', '🔵'];
const matchScoredEmojis = ['👍', '👎'];

const createMatchEmbed = match => {
	let color;
	if (!match.hasOwnProperty('redScore')) {
		color = 0xffffff;
	} else if (match.redScore === match.blueScore) {
		color = 'GREY';
	} else {
		color = (match.redScore > match.blueScore) ? 'RED' : 'BLUE';
	}
	let red = `${matchScheduledEmojis[0]} Red`;
	let blue = `${matchScheduledEmojis[1]} Blue`;
	if (match.hasOwnProperty('redScore')) {
		red += `: ${match.redScore}`;
		blue += `: ${match.blueScore}`;
	}
	const embed = new Discord.RichEmbed()
		.setColor(color)
		.setAuthor(match._id.event.name, null, `https://vexdb.io/events/view/${match._id.event._id}`)
		.setTitle(match._id.division)
		.setURL(`https://vexdb.io/events/view/${match._id.event._id}?t=results&d=${match._id.division.replace(/ /g, '+')}`)
		.setDescription(createMatchString(match._id.round, match._id.instance, match._id.number))
		.addField(red, createTeamsString([match.red, match.red2, match.red3], match.redSit), true)
		.addField(blue, createTeamsString([match.blue, match.blue2, match.blue3], match.blueSit), true);
	if (match.hasOwnProperty('start')) {
		embed.setTimestamp(new Date(match.start));
	}
	return embed;
};

const createAwardEmbed = async award => {
	const skus = (award.qualifies || []).push(award._id.event);
	const events = await db.collection('events').find({_id: {$in: skus}}).project({_id: 1, name: 1}).toArray();
	let eventName;
	events.forEach(event => {
		if (event._id === award._id.event) {
			eventName = event.name;
		} else {
			award.qualifies[award.qualifies.indexOf(event._id)] = `[${event.name}](https://vexdb.io/events/view/${event._id})`;
		}
	});
	const embed = new Discord.RichEmbed()
		.setColor('PURPLE')
		.setAuthor(eventName, null, `https://vexdb.io/events/view/${award._id.event}?t=awards`)
		.setTitle(award._id.name);
	if (award.team) {
		embed.addField('Team', `[${decodeProgram(isNaN(teamId.charAt(0)) ? 4 : event.prog)} ${award.team}](https://vexdb.io/teams/view/${award.team})`, true);
	}
	if (award.qualifies) {
		embed.addField('Qualifies for', qualifies.join('\n'), true);
	}
	return embed;
};

const createSkillsEmbed = async skill => {
	let embed;
	try {
		const event = await db.collection('events').findOne({_id: skill._id.event});
		embed = new Discord.RichEmbed()
			.setColor('GOLD')
			.setAuthor(event.name, null, `https://vexdb.io/events/view/${event._id}?t=skills`)
			.setTitle(`${decodeProgram(skill._id.team.prog)} ${skill._id.team.id}`)
			.setURL(`https://vexdb.io/teams/view/${skill._id.team.id}?t=skills`)
			.addField('Type', decodeSkill(skill._id.type), true)
			.addField('Score', skill.score, true);
	} catch (err) {
		console.error(err);
	} finally {
		return embed;
	}
};

const getMatchTeams = match => [match.red, match.red2, match.red3, match.blue, match.blue2, match.red3].filter(team => team).map(team => {
	return {prog: (isNaN(team.charAt(0)) ? 4 : match._id.event.prog), id: team};
});

const sendMatchEmbed = async (content, match, reactions) => {
	try {
		match._id.event = await db.collection('events').findOne({_id: match._id.event});
		await sendToSubscribedChannels(content, {embed: createMatchEmbed(match)}, getMatchTeams(match), reactions);
	} catch (err) {
		console.error(err);
	}
};

const subscribedChannels = [
	'352003193666011138',
	'329477820076130306'  // Dev server.
];

const sendToSubscribedChannels = async (content, options, teams, reactions = []) => {
	subscribedChannels.forEach(async id => {
		const channel = client.channels.get(id);
		if (channel) {
			try {
				const teamSubs = await db.collection('teamSubs').find({_id: {guild: channel.guild.id, team: {$in: teams}}}).toArray();
				let text;
				if (teamSubs) {
					text = teamSubs.map(teamSub => teamSub.users.map(subscriber => `<@${subscriber}>`).join('')).join('');
				}
				if (content) {
					text = text ? `${text}\n${content}` : content;
				}
				const message = await channel.send(text ? `${text}:` : undefined, options).catch(console.error);
				for (let reaction of reactions) {
					await message.react(reaction);
				}
			} catch (err) {
				console.error(err);
			}
		}
	});
};

const escapeMarkdown = string => string ? string.replace(/([*^_`~])/g, '\\$1') : '';

const createTeamChangeEmbed = (program, teamId, field, oldValue, newValue) => {
	let change;
	if (!oldValue) {
		change = `added their ${field} **"**${escapeMarkdown(he.decode(newValue))}**"**`;
	} else if (!newValue) {
		change = `removed their ${field} **"**${escapeMarkdown(he.decode(oldValue))}**"**`;
	} else {
		change = `changed their ${field} from **"**${escapeMarkdown(he.decode(oldValue))}**"** to **"**${escapeMarkdown(he.decode(newValue))}**"**`;
	}
	return new Discord.RichEmbed()
		.setColor('GREEN')
		.setDescription(`[${decodeProgram(program)} ${teamId}](https://vexdb.io/teams/view/${teamId}) ${change}.`);
};

module.exports = {
	getTeamId: getTeamId,
	validTeamId: validTeamId,
	getTeam: getTeam,
	getTeamLocation: getTeamLocation,
	createTeamEmbed: createTeamEmbed,
	createMatchEmbed: createMatchEmbed,
	createSkillsEmbed: createSkillsEmbed,
	createAwardEmbed: createAwardEmbed,
	createTeamChangeEmbed: createTeamChangeEmbed,
	sendToSubscribedChannels: sendToSubscribedChannels,
	sendMatchEmbed: sendMatchEmbed,
	matchScheduledEmojis: matchScheduledEmojis,
	matchScoredEmojis: matchScoredEmojis
};
