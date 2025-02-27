import { Meteor } from 'meteor/meteor';
import { Match, check } from 'meteor/check';
import _ from 'underscore';
import type { ServerMethods } from '@rocket.chat/ui-contexts';
import type { IRoom, ISubscription } from '@rocket.chat/core-typings';
import type { Mongo } from 'meteor/mongo';

import { hasPermissionAsync } from '../../app/authorization/server/functions/hasPermission';
import { Rooms, Subscriptions, Users } from '../../app/models/server';
import { getUserPreference } from '../../app/utils/server';
import { settings } from '../../app/settings/server';
import { trim } from '../../lib/utils/stringUtils';

declare module '@rocket.chat/ui-contexts' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		channelsList(filter: string, channelType: string, limit?: number, sort?: string): { channels: IRoom[] };
	}
}

Meteor.methods<ServerMethods>({
	async channelsList(filter, channelType, limit, sort) {
		check(filter, String);
		check(channelType, String);
		check(limit, Match.Optional(Number));
		check(sort, Match.Optional(String));

		const userId = Meteor.userId();

		if (!userId) {
			throw new Meteor.Error('error-invalid-user', 'Invalid user', {
				method: 'channelsList',
			});
		}

		const options: Mongo.Options<IRoom> = {
			fields: {
				name: 1,
				t: 1,
			},
			sort: {
				msgs: -1,
			},
		};

		if (_.isNumber(limit)) {
			options.limit = limit;
		}

		if (trim(sort)) {
			switch (sort) {
				case 'name':
					options.sort = {
						name: 1,
					};
					break;
				case 'msgs':
					options.sort = {
						msgs: -1,
					};
			}
		}

		let channels: IRoom[] = [];

		if (channelType !== 'private') {
			if (await hasPermissionAsync(userId, 'view-c-room')) {
				if (filter) {
					channels = channels.concat(Rooms.findByTypeAndNameContaining('c', filter, options).fetch());
				} else {
					channels = channels.concat(Rooms.findByType('c', options).fetch());
				}
			} else if (await hasPermissionAsync(userId, 'view-joined-room')) {
				const roomIds = Subscriptions.findByTypeAndUserId('c', userId, { fields: { rid: 1 } })
					.fetch()
					.map((s: ISubscription) => s.rid);
				if (filter) {
					channels = channels.concat(Rooms.findByTypeInIdsAndNameContaining('c', roomIds, filter, options).fetch());
				} else {
					channels = channels.concat(Rooms.findByTypeInIds('c', roomIds, options).fetch());
				}
			}
		}

		if (channelType !== 'public' && (await hasPermissionAsync(userId, 'view-p-room'))) {
			const user = Users.findOne(userId, {
				fields: {
					'username': 1,
					'settings.preferences.sidebarGroupByType': 1,
				},
			});
			const userPref = getUserPreference(user, 'sidebarGroupByType');
			// needs to negate globalPref because userPref represents its opposite
			const groupByType = userPref !== undefined ? userPref : settings.get('UI_Group_Channels_By_Type');

			if (!groupByType) {
				const roomIds = Subscriptions.findByTypeAndUserId('p', userId, { fields: { rid: 1 } })
					.fetch()
					.map((s: ISubscription) => s.rid);
				if (filter) {
					channels = channels.concat(Rooms.findByTypeInIdsAndNameContaining('p', roomIds, filter, options).fetch());
				} else {
					channels = channels.concat(Rooms.findByTypeInIds('p', roomIds, options).fetch());
				}
			}
		}

		return {
			channels,
		};
	},
});
