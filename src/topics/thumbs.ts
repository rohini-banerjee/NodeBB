import _ from 'lodash';
import nconf from 'nconf';
import path from 'path';
import validator from 'validator';

import db from '../database';
import file from '../file';
import plugins from '../plugins';
import posts from '../posts';
import meta from '../meta';
import cache from '../cache';

import topics from '.';

// Declaring defined types below

type T = {
    numThumbs: string,
    tid: number
}

type Thumb = {
    value: string
    score: number
}

type UserResponse = {
    id: number,
    name: string,
    url: string
}

type NewFile = {
    id: number,
    path: string,
    score: number
}

type ThumbsType = {
    exists: (id: number, path: string) => Promise<boolean>;
    load: (topicData: T[]) => Promise<(UserResponse[] | UserResponse)[]>;
    get: (tids: number[]) => Promise<UserResponse[] | UserResponse[][]>;
    associate: ({ id, path, score }: NewFile) => Promise<void>;
    migrate: (uuid: number, id: number) => Promise<void>;
    delete: (id: number, relativePaths: string | string[]) => Promise<void>;
    deleteAll: (id: number) => Promise<void>;
};

const Thumbs: ThumbsType | null = null;

// Defining object methods

Thumbs.exists = async function (id: number, path: string): Promise<boolean> {
    const isDraft: boolean = validator.isUUID(String(id));
    const set = `${isDraft ? 'draft' : 'topic'}:${id}:thumbs`;

    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    return db.isSortedSetMember(set, path) as boolean;
};


Thumbs.load = async function (topicData: T[]): Promise<(UserResponse[] | UserResponse)[]> {
    const topicsWithThumbs: T[] = topicData.filter(t => t && parseInt(t.numThumbs, 10) > 0);
    const tidsWithThumbs: number[] = topicsWithThumbs.map(t => t.tid);
    // Cannot determine actual return type of Thumbs.get(...), since this function uses
    // cache package to generate 'thumb' elements that are part of this returned value.
    const thumbs: UserResponse[] | UserResponse[][] = await Thumbs.get(tidsWithThumbs);
    const tidToThumbs : _.Dictionary<UserResponse> = _.zipObject(tidsWithThumbs, thumbs as UserResponse[]);
    return topicData.map(t => (t && t.tid ? (tidToThumbs[t.tid] || []) : []));
};

async function getThumbs(set: string): Promise<string[]> {
    const cached: string[] = cache.get(set);
    if (cached !== undefined) {
        return cached.slice();
    }

    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const thumbs: string[] = await db.getSortedSetRange(set, 0, -1);
    cache.set(set, thumbs);
    return thumbs.slice();
}

Thumbs.get = async function (tids: number[]): Promise<UserResponse[] | UserResponse[][]> {
    // Allow singular or plural usage
    let singular = false;
    if (!Array.isArray(tids)) {
        tids = [tids];
        singular = true;
    }

    // Note sure how to fix "unsafe member access" since 'meta' is from another
    // file in the NodeBB directory and not a variable explicitly defined in
    // src/topics/thumbs.js.
    if (!meta.config.allowTopicsThumbnail || !tids.length) {
        return singular ? [] : tids.map(() => []);
    }

    const hasTimestampPrefix = /^\d+-/;
    const upload_url: string = (nconf.get('relative_path') as string) + (nconf.get('upload_url') as string);
    const sets: string[] = tids.map(tid => `${validator.isUUID(String(tid)) ? 'draft' : 'topic'}:${tid}:thumbs`);
    const thumbs: string[][] = await Promise.all(sets.map(getThumbs));
    let response : UserResponse[][] = thumbs.map((thumbSet:string[], idx: number) => thumbSet.map(thumb => ({
        id: tids[idx],
        name: (() => {
            const name: string = path.basename(thumb);
            return hasTimestampPrefix.test(name) ? name.slice(14) : name;
        })(),
        url: thumb.startsWith('http') ? thumb : path.posix.join(upload_url, thumb),
    })));

    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    ({ thumbs: response } = await plugins.hooks.fire('filter:topics.getThumbs', { tids, thumbs: response }));
    return singular ? response.pop() : response;
};

Thumbs.associate = async function ({ id, path, score }: NewFile): Promise<void> {
    // Associates a newly uploaded file as a thumb to the passed-in draft or topic
    const isDraft = validator.isUUID(String(id));
    const isLocal = !path.startsWith('http');
    const set = `${isDraft ? 'draft' : 'topic'}:${id}:thumbs`;
    // Don't know how to fix unsafe assignment on next line 
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const numThumbs = await db.sortedSetCard(set);

    // Normalize the path to allow for changes in upload_path (and so upload_url can be appended if needed)
    if (isLocal) {
        path = path.replace(nconf.get('upload_path'), '');
    }
    await db.sortedSetAdd(set, isFinite(score) ? score : numThumbs, path);
    if (!isDraft) {
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const numThumbs = await db.sortedSetCard(set);
        await topics.setTopicField(id, 'numThumbs', numThumbs);
    }
    cache.del(set);

    // Associate thumbnails with the main pid (only on local upload)
    if (!isDraft && isLocal) {
        const mainPid: number = (await topics.getMainPids([id]) as number[])[0];
        await posts.uploads.associate(mainPid, path.slice(1));
    }
};

export default Thumbs;