import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { api, Team } from '@rocket.chat/core-services';
import type { IRoom, IUser } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ui-contexts';

import { hasPermissionAsync } from '../../app/authorization/server/functions/hasPermission';
import { Users, Subscriptions, Messages } from '../../app/models/server';
import { settings } from '../../app/settings/server';

declare module '@rocket.chat/ui-contexts' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		removeRoomLeader(rid: IRoom['_id'], userId: IUser['_id']): boolean;
	}
}

Meteor.methods<ServerMethods>({
	async removeRoomLeader(rid, userId) {
		check(rid, String);
		check(userId, String);

		const uid = Meteor.userId();

		if (!uid) {
			throw new Meteor.Error('error-invalid-user', 'Invalid user', {
				method: 'removeRoomLeader',
			});
		}

		if (!(await hasPermissionAsync(uid, 'set-leader', rid))) {
			throw new Meteor.Error('error-not-allowed', 'Not allowed', {
				method: 'removeRoomLeader',
			});
		}

		const user = Users.findOneById(userId);

		if (!user?.username) {
			throw new Meteor.Error('error-invalid-user', 'Invalid user', {
				method: 'removeRoomLeader',
			});
		}

		const subscription = Subscriptions.findOneByRoomIdAndUserId(rid, user._id);

		if (!subscription) {
			throw new Meteor.Error('error-user-not-in-room', 'User is not in this room', {
				method: 'removeRoomLeader',
			});
		}

		if (Array.isArray(subscription.roles) === true && subscription.roles.includes('leader') === false) {
			throw new Meteor.Error('error-user-not-leader', 'User is not a leader', {
				method: 'removeRoomLeader',
			});
		}

		Subscriptions.removeRoleById(subscription._id, 'leader');

		const fromUser = Users.findOneById(uid);

		Messages.createSubscriptionRoleRemovedWithRoomIdAndUser(rid, user, {
			u: {
				_id: fromUser._id,
				username: fromUser.username,
			},
			role: 'leader',
		});

		const team = await Team.getOneByMainRoomId(rid);
		if (team) {
			await Team.removeRolesFromMember(team._id, userId, ['leader']);
		}

		if (settings.get('UI_DisplayRoles')) {
			void api.broadcast('user.roleUpdate', {
				type: 'removed',
				_id: 'leader',
				u: {
					_id: user._id,
					username: user.username,
					name: user.name,
				},
				scope: rid,
			});
		}

		return true;
	},
});
