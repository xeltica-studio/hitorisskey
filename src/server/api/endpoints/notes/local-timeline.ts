import $ from 'cafy';
import { ID } from '../../../../misc/cafy-id';
import define from '../../define';
import { fetchMeta } from '../../../../misc/fetch-meta';
import { ApiError } from '../../error';
import { Notes } from '../../../../models';
import { generateMuteQuery } from '../../common/generate-mute-query';
import { makePaginationQuery } from '../../common/make-pagination-query';
import { generateVisibilityQuery } from '../../common/generate-visibility-query';
import { activeUsersChart } from '../../../../services/chart';
import { Brackets } from 'typeorm';
import { generateRepliesQuery } from '../../common/generate-replies-query';
import { injectPromo } from '../../common/inject-promo';
import { injectFeatured } from '../../common/inject-featured';

export const meta = {
	desc: {
		'ja-JP': 'ローカルタイムラインを取得します。'
	},

	tags: ['notes'],

	params: {
		withFiles: {
			validator: $.optional.bool,
			desc: {
				'ja-JP': 'ファイルが添付された投稿に限定するか否か'
			}
		},

		fileType: {
			validator: $.optional.arr($.str),
			desc: {
				'ja-JP': '指定された種類のファイルが添付された投稿のみを取得します'
			}
		},

		excludeNsfw: {
			validator: $.optional.bool,
			default: false,
			desc: {
				'ja-JP': 'true にすると、NSFW指定されたファイルを除外します(fileTypeが指定されている場合のみ有効)'
			}
		},

		limit: {
			validator: $.optional.num.range(1, 100),
			default: 10
		},

		sinceId: {
			validator: $.optional.type(ID),
		},

		untilId: {
			validator: $.optional.type(ID),
		},

		sinceDate: {
			validator: $.optional.num,
		},

		untilDate: {
			validator: $.optional.num,
		},
	},

	res: {
		type: 'array' as const,
		optional: false as const, nullable: false as const,
		items: {
			type: 'object' as const,
			optional: false as const, nullable: false as const,
			ref: 'Note',
		}
	},
};

export default define(meta, async (ps, user) => {
	//#region Construct query
	const query = makePaginationQuery(Notes.createQueryBuilder('note'),
			ps.sinceId, ps.untilId, ps.sinceDate, ps.untilDate)
		.andWhere('(note.visibility = \'public\') AND (note.userHost IS NULL)')
		.leftJoinAndSelect('note.user', 'user');

	generateRepliesQuery(query, user);
	generateVisibilityQuery(query, user);
	if (user) generateMuteQuery(query, user);

	if (ps.withFiles) {
		query.andWhere('note.fileIds != \'{}\'');
	}

	if (ps.fileType != null) {
		query.andWhere('note.fileIds != \'{}\'');
		query.andWhere(new Brackets(qb => {
			for (const type of ps.fileType!) {
				const i = ps.fileType!.indexOf(type);
				qb.orWhere(`:type${i} = ANY(note.attachedFileTypes)`, { [`type${i}`]: type });
			}
		}));

		if (ps.excludeNsfw) {
			query.andWhere('note.cw IS NULL');
			query.andWhere('0 = (SELECT COUNT(*) FROM drive_file df WHERE df.id = ANY(note."fileIds") AND df."isSensitive" = TRUE)');
		}
	}
	//#endregion

	const timeline = await query.take(ps.limit!).getMany();

	process.nextTick(() => {
		if (user) {
			activeUsersChart.update(user);
		}
	});

	return await Notes.packMany(timeline, user);
});
