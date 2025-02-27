import type { IRoom } from '@rocket.chat/apps-engine/definition/rooms';
import { RoomType } from '@rocket.chat/apps-engine/definition/rooms';
import { RoomBridge } from '@rocket.chat/apps-engine/server/bridges/RoomBridge';
import type { IUser } from '@rocket.chat/apps-engine/definition/users';
import type { IMessage } from '@rocket.chat/apps-engine/definition/messages';
import { Meteor } from 'meteor/meteor';
import type { ISubscription, IUser as ICoreUser } from '@rocket.chat/core-typings';

import type { AppServerOrchestrator } from '../../../../ee/server/apps/orchestrator';
import { Rooms, Subscriptions, Users } from '../../../models/server';
import { addUserToRoom } from '../../../lib/server/functions/addUserToRoom';
import { deleteRoom } from '../../../lib/server/functions/deleteRoom';

export class AppRoomBridge extends RoomBridge {
	// eslint-disable-next-line no-empty-function
	constructor(private readonly orch: AppServerOrchestrator) {
		super();
	}

	protected async create(room: IRoom, members: Array<string>, appId: string): Promise<string> {
		this.orch.debugLog(`The App ${appId} is creating a new room.`, room);

		const rcRoom = this.orch.getConverters()?.get('rooms').convertAppRoom(room);
		let method: string;

		switch (room.type) {
			case RoomType.CHANNEL:
				method = 'createChannel';
				break;
			case RoomType.PRIVATE_GROUP:
				method = 'createPrivateGroup';
				break;
			case RoomType.DIRECT_MESSAGE:
				method = 'createDirectMessage';
				break;
			default:
				throw new Error('Only channels, private groups and direct messages can be created.');
		}

		let rid = '';
		await Meteor.runAsUser(room.creator.id, async () => {
			const extraData = Object.assign({}, rcRoom);
			delete extraData.name;
			delete extraData.t;
			delete extraData.ro;
			delete extraData.customFields;
			let info;
			if (room.type === RoomType.DIRECT_MESSAGE) {
				info = await Meteor.callAsync(method, ...members);
			} else {
				info = await Meteor.callAsync(method, rcRoom.name, members, rcRoom.ro, rcRoom.customFields, extraData);
			}
			rid = info.rid;
		});

		return rid;
	}

	protected async getById(roomId: string, appId: string): Promise<IRoom> {
		this.orch.debugLog(`The App ${appId} is getting the roomById: "${roomId}"`);

		return this.orch.getConverters()?.get('rooms').convertById(roomId);
	}

	protected async getByName(roomName: string, appId: string): Promise<IRoom> {
		this.orch.debugLog(`The App ${appId} is getting the roomByName: "${roomName}"`);

		return this.orch.getConverters()?.get('rooms').convertByName(roomName);
	}

	protected async getCreatorById(roomId: string, appId: string): Promise<IUser | undefined> {
		this.orch.debugLog(`The App ${appId} is getting the room's creator by id: "${roomId}"`);

		const room = Rooms.findOneById(roomId);

		if (!room || !room.u || !room.u._id) {
			return undefined;
		}

		return this.orch.getConverters()?.get('users').convertById(room.u._id);
	}

	protected async getCreatorByName(roomName: string, appId: string): Promise<IUser | undefined> {
		this.orch.debugLog(`The App ${appId} is getting the room's creator by name: "${roomName}"`);

		const room = Rooms.findOneByName(roomName, {});

		if (!room || !room.u || !room.u._id) {
			return undefined;
		}

		return this.orch.getConverters()?.get('users').convertById(room.u._id);
	}

	protected async getMembers(roomId: string, appId: string): Promise<Array<IUser>> {
		this.orch.debugLog(`The App ${appId} is getting the room's members by room id: "${roomId}"`);
		const subscriptions = await Subscriptions.findByRoomId(roomId, {});
		return subscriptions.map((sub: ISubscription) => this.orch.getConverters()?.get('users').convertById(sub.u?._id));
	}

	protected async getDirectByUsernames(usernames: Array<string>, appId: string): Promise<IRoom | undefined> {
		this.orch.debugLog(`The App ${appId} is getting direct room by usernames: "${usernames}"`);
		const room = await Rooms.findDirectRoomContainingAllUsernames(usernames, {});
		if (!room) {
			return undefined;
		}
		return this.orch.getConverters()?.get('rooms').convertRoom(room);
	}

	protected async update(room: IRoom, members: Array<string> = [], appId: string): Promise<void> {
		this.orch.debugLog(`The App ${appId} is updating a room.`);

		if (!room.id || !Rooms.findOneById(room.id)) {
			throw new Error('A room must exist to update.');
		}

		const rm = this.orch.getConverters()?.get('rooms').convertAppRoom(room);

		Rooms.update(rm._id, rm);

		for await (const username of members) {
			const member = Users.findOneByUsername(username, {});

			if (!member) {
				continue;
			}

			await addUserToRoom(rm._id, member);
		}
	}

	protected async delete(roomId: string, appId: string): Promise<void> {
		this.orch.debugLog(`The App ${appId} is deleting a room.`);
		deleteRoom(roomId);
	}

	protected async createDiscussion(
		room: IRoom,
		parentMessage: IMessage | undefined = undefined,
		reply: string | undefined = '',
		members: Array<string> = [],
		appId: string,
	): Promise<string> {
		this.orch.debugLog(`The App ${appId} is creating a new discussion.`, room);

		const rcRoom = this.orch.getConverters()?.get('rooms').convertAppRoom(room);

		let rcMessage;
		if (parentMessage) {
			rcMessage = this.orch.getConverters()?.get('messages').convertAppMessage(parentMessage);
		}

		if (!rcRoom.prid || !Rooms.findOneById(rcRoom.prid)) {
			throw new Error('There must be a parent room to create a discussion.');
		}

		const discussion = {
			prid: rcRoom.prid,
			t_name: rcRoom.fname,
			pmid: rcMessage ? rcMessage._id : undefined,
			reply: reply && reply.trim() !== '' ? reply : undefined,
			users: members.length > 0 ? members : [],
		};

		let rid = '';
		await Meteor.runAsUser(room.creator.id, async () => {
			const info = await Meteor.callAsync('createDiscussion', discussion);
			rid = info.rid;
		});

		return rid;
	}

	protected getModerators(roomId: string, appId: string): Promise<IUser[]> {
		this.orch.debugLog(`The App ${appId} is getting room moderators for room id: ${roomId}`);
		return this.getUsersByRoomIdAndSubscriptionRole(roomId, 'moderator');
	}

	protected getOwners(roomId: string, appId: string): Promise<IUser[]> {
		this.orch.debugLog(`The App ${appId} is getting room owners for room id: ${roomId}`);
		return this.getUsersByRoomIdAndSubscriptionRole(roomId, 'owner');
	}

	protected getLeaders(roomId: string, appId: string): Promise<IUser[]> {
		this.orch.debugLog(`The App ${appId} is getting room leaders for room id: ${roomId}`);
		return this.getUsersByRoomIdAndSubscriptionRole(roomId, 'leader');
	}

	private async getUsersByRoomIdAndSubscriptionRole(roomId: string, role: string): Promise<IUser[]> {
		const subs = await Subscriptions.findByRoomIdAndRoles(roomId, [role], { projection: { uid: '$u._id', _id: 0 } });
		const users = await Users.findByIds(subs.map((user: { uid: string }) => user.uid));
		const userConverter = this.orch.getConverters()!.get('users');
		return users.map((user: ICoreUser) => userConverter!.convertToApp(user));
	}
}
