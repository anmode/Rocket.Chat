import { Meteor } from 'meteor/meteor';
import { TAPi18n } from 'meteor/rocketchat:tap-i18n';
import { api } from '@rocket.chat/core-services';

import { Rooms, Messages } from '../../models/server';
import { slashCommands } from '../../utils/lib/slashCommand';
import { settings } from '../../settings/server';

slashCommands.add({
	command: 'archive',
	callback: async function Archive(_command, params, item): Promise<void> {
		let channel = params.trim();

		let room;

		if (channel === '') {
			room = Rooms.findOneById(item.rid);
			channel = room.name;
		} else {
			channel = channel.replace('#', '');
			room = Rooms.findOneByName(channel);
		}

		const userId = Meteor.userId();

		if (!userId) {
			return;
		}

		if (!room) {
			void api.broadcast('notify.ephemeralMessage', userId, item.rid, {
				msg: TAPi18n.__('Channel_doesnt_exist', {
					postProcess: 'sprintf',
					sprintf: [channel],
					lng: settings.get('Language') || 'en',
				}),
			});
			return;
		}

		// You can not archive direct messages.
		if (room.t === 'd') {
			return;
		}

		if (room.archived) {
			void api.broadcast('notify.ephemeralMessage', userId, item.rid, {
				msg: TAPi18n.__('Duplicate_archived_channel_name', {
					postProcess: 'sprintf',
					sprintf: [channel],
					lng: settings.get('Language') || 'en',
				}),
			});
			return;
		}
		await Meteor.callAsync('archiveRoom', room._id);

		Messages.createRoomArchivedByRoomIdAndUser(room._id, Meteor.user());
		void api.broadcast('notify.ephemeralMessage', userId, item.rid, {
			msg: TAPi18n.__('Channel_Archived', {
				postProcess: 'sprintf',
				sprintf: [channel],
				lng: settings.get('Language') || 'en',
			}),
		});
	},
	options: {
		description: 'Archive',
		params: '#channel',
		permission: 'archive-room',
	},
});
