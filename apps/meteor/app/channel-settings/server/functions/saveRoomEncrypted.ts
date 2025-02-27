import { Meteor } from 'meteor/meteor';
import { Match } from 'meteor/check';
import type { UpdateResult } from 'mongodb';
import type { IUser } from '@rocket.chat/core-typings';
import { Rooms } from '@rocket.chat/models';

import { Messages } from '../../../models/server';

export const saveRoomEncrypted = async function (rid: string, encrypted: boolean, user: IUser, sendMessage = true): Promise<UpdateResult> {
	if (!Match.test(rid, String)) {
		throw new Meteor.Error('invalid-room', 'Invalid room', {
			function: 'RocketChat.saveRoomEncrypted',
		});
	}

	const update = await Rooms.saveEncryptedById(rid, encrypted);
	if (update && sendMessage) {
		Messages.createRoomSettingsChangedWithTypeRoomIdMessageAndUser(
			`room_e2e_${encrypted ? 'enabled' : 'disabled'}`,
			rid,
			user.username,
			user,
			{},
		);
	}
	return update;
};
