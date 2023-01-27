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
    const thumbs: UserResponse[] | UserResponse[][] = await Thumbs.get(tidsWithThumbs);
    const tidToThumbs : _.Dictionary<UserResponse> = _.zipObject(tidsWithThumbs, thumbs as UserResponse[]);
    return topicData.map(t => (t && t.tid ? (tidToThumbs[t.tid] || []) : []));
};