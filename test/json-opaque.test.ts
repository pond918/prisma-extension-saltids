import { describe, it, expect } from 'vitest';
import { deepTransformInput, deepHijackResult, deepInjectSalt } from '../src/logic';
import { ModelRegistry, SaltIdsHelper } from '../src/utils';

const SALT_LEN = 4;
const SUFFIX = 'Salt';
const options = {
  saltLength: SALT_LEN,
  saltSuffix: SUFFIX,
  rawResultHijack: true,
  prisma: {},
} as any;

const randRaw = () => 100000 + Math.floor(Math.random() * 800000);
const randSalt = () => Math.floor(Math.random() * 10000);
const handleOf = (raw: number, salt: number) => SaltIdsHelper.encode(raw, salt, SALT_LEN);

function messageLikeRegistry() {
  const registry = new ModelRegistry();
  const scalar = (name: string, type = 'Int') => ({
    kind: 'scalar',
    type,
    name,
    isList: false,
    hasDefaultValue: false,
    default: undefined,
  });
  registry.init(
    {
      datamodel: {
        models: [
          {
            name: 'Message',
            fields: [
              scalar('id'),
              scalar('idSalt'),
              scalar('userId'),
              scalar('userIdSalt'),
              scalar('taskId'),
              scalar('taskIdSalt'),
              { ...scalar('req', 'Json') },
            ],
            uniqueFields: [],
            uniqueIndexes: [],
          },
        ],
        enums: [],
        types: [],
      },
    },
    SUFFIX
  );
  return registry;
}

describe('json opaque boundary (red: plugin must not interpret Json internals)', () => {
  it('write data: model columns decode, Json payload stays verbatim', () => {
    const registry = messageLikeRegistry();
    const rawUser = randRaw();
    const saltUser = randSalt();
    const userHandle = handleOf(rawUser, saltUser);
    const rawTask = randRaw();
    const saltTask = randSalt();
    const taskHandle = handleOf(rawTask, saltTask);
    const businessNumber = 100000 + Math.floor(Math.random() * 800000);

    const args: any = {
      data: {
        userId: userHandle,
        taskId: taskHandle,
        req: {
          userId: userHandle,
          taskId: taskHandle,
          businessNumber,
        },
      },
    };
    deepTransformInput(args, 'Message', registry, options);

    // Model columns follow the declared column-pair law.
    expect(args.data.userId).toBe(rawUser);
    expect(args.data.userIdSalt).toBe(saltUser);
    expect(args.data.taskId).toBe(rawTask);
    expect(args.data.taskIdSalt).toBe(saltTask);
    // Json is opaque: no nested conversion, no injected salt siblings.
    expect(args.data.req.userId).toBe(userHandle);
    expect(args.data.req.taskId).toBe(taskHandle);
    expect(args.data.req.businessNumber).toBe(businessNumber);
    expect(args.data.req.userIdSalt).toBeUndefined();
    expect(args.data.req.taskIdSalt).toBeUndefined();
  });

  it('where filters: scalar handle decodes, Json equals operand stays verbatim', () => {
    const registry = messageLikeRegistry();
    const rawUser = randRaw();
    const saltUser = randSalt();
    const userHandle = handleOf(rawUser, saltUser);

    const args: any = {
      where: {
        userId: userHandle,
        req: { equals: { userId: userHandle } },
      },
    };
    deepTransformInput(args, 'Message', registry, options);

    expect(args.where.userId).toBe(rawUser);
    expect(args.where.userIdSalt).toBe(saltUser);
    expect(args.where.req).toEqual({ equals: { userId: userHandle } });
  });

  it('result hijack: model columns re-encode, Json interior untouched', () => {
    const registry = messageLikeRegistry();
    const rawUser = randRaw();
    const saltUser = randSalt();
    const userHandle = handleOf(rawUser, saltUser);

    const row: any = {
      userId: rawUser,
      userIdSalt: saltUser,
      req: { userId: userHandle, note: 'hello' },
    };
    deepHijackResult(row, options, 'Message', registry);

    expect(row.userId).toBe(userHandle);
    expect(row.req).toEqual({ userId: userHandle, note: 'hello' });
  });

  it('salt injection: never injects salt siblings inside Json', () => {
    const registry = messageLikeRegistry();
    const rawUser = randRaw();
    const saltUser = randSalt();
    const userHandle = handleOf(rawUser, saltUser);

    const data: any = { req: { userId: userHandle } };
    deepInjectSalt(data, 'Message', registry, options, false);
    expect(data.req).toEqual({ userId: userHandle });
  });
});
