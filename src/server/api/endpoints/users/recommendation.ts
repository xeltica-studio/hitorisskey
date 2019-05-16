import * as ms from 'ms';
import $ from 'cafy';
import User, { pack, ILocalUser, IUser } from '../../../../models/user';
import { getFriendIds } from '../../common/get-friends';
import * as request from 'request-promise-native';
import config from '../../../../config';
import define from '../../define';
import fetchMeta from '../../../../misc/fetch-meta';
import resolveUser from '../../../../remote/resolve-user';
import { getHideUserIds } from '../../common/get-hide-users';
import { apiLogger } from '../../logger';

export const meta = {
	desc: {
		'ja-JP': 'おすすめのユーザー一覧を取得します。'
	},

	tags: ['users'],

	requireCredential: false,

	kind: 'account-read',

	params: {
		limit: {
			validator: $.optional.num.range(1, 100),
			default: 10
		},

		offset: {
			validator: $.optional.num.min(0),
			default: 0
		}
	},

	res: {
		type: 'array',
		items: {
			type: 'User',
		}
	},
};

export default define(meta, async (ps, me) => {
	const instance = await fetchMeta();

	if (instance.enableExternalUserRecommendation && me != null) {
		const userName = me.username;
		const hostName = config.hostname;
		const limit = ps.limit;
		const offset = ps.offset;
		const timeout = instance.externalUserRecommendationTimeout;
		const engine = instance.externalUserRecommendationEngine;
		const url = engine
			.replace('{{host}}', hostName)
			.replace('{{user}}', userName)
			.replace('{{limit}}', limit.toString())
			.replace('{{offset}}', offset.toString());

		const users = await request({
			url: url,
			proxy: config.proxy,
			timeout: timeout,
			forever: true,
			json: true,
			followRedirect: true,
			followAllRedirects: true
		})
		.then(body => convertUsers(body, me));

		return users;
	} else {
		// ID list of the user itself and other users who the user follows
		const followingIds = me != null ? await getFriendIds(me._id) : [];

		// 隠すユーザーを取得
		const hideUserIds = await getHideUserIds(me);

		const users = await User.aggregate([{
			$match: {
				updatedAt: { $gte: new Date(Date.now() - ms('5days')) },
				followersCount: { $gte: 10 },
				followingCount: { $gte: 10 },
				notesCount: { $gte: 10 },
				_id: { $nin: followingIds.concat(hideUserIds) },
				isBot: { $ne: true },
			}
		}, {
			$addFields: {
				fb: { $divide: [ '$followingCount', '$followersCount' ] }
			},
		}, {
			$match: {
				fb: { $gt: 0.5 },
			}
		}, {
			$match: {
				fb: { $lt: 5 },
			}
		}, {
			$sort: {
				followersCount: -1
			}
		}, {
			$limit: ps.limit
		}, {
			$skip: ps.offset
		}]) as IUser[];

		return await Promise.all(users.map(user => pack(user._id, me, { detail: true })));
	}
});

type IRecommendUser = {
	name: string;
	username: string;
	host: string;
	description: string;
	avatarUrl: string;
};

/**
 * Resolve/Pack dummy users
 */
async function convertUsers(src: IRecommendUser[], me: ILocalUser) {
	const packed = await Promise.all(src.map(async x => {
		const user = await resolveUser(x.username, x.host)
			.catch(() => {
				apiLogger.warn(`Can't resolve ${x.username}@${x.host}`);
				return null;
			});

		if (user == null) return x;

		return await pack(user, me, { detail: true });
	}));

	return packed;
}
