import { createStoreIdentity } from "./storeIdentity";
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
describe("store account identity", () => {
  it("serializes a delayed login before connecting the latest account", async () => {
    const first = deferred();
    const sdk = { logIn: jest.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined), logOut: jest.fn() };
    const identity = createStoreIdentity(sdk);
    identity.setDesired("a"); const old = identity.sync();
    await Promise.resolve();
    identity.setDesired("b"); const latest = identity.sync();
    expect(sdk.logIn).toHaveBeenCalledTimes(1);
    first.resolve();
    expect(await old).toBe(false);
    expect(await latest).toBe(true);
    expect(sdk.logIn.mock.calls).toEqual([["a"], ["b"]]);
  });
  it("rejects guest/stale-account purchases and restores before contacting the store", async () => {
    const sdk = { logIn: jest.fn().mockResolvedValue(undefined), logOut: jest.fn() };
    const identity = createStoreIdentity(sdk); const purchase = jest.fn();
    identity.setDesired("b");
    await expect(identity.run("a", purchase)).rejects.toThrow("Sign in");
    await expect(identity.run(null, purchase)).rejects.toThrow("Sign in");
    expect(purchase).not.toHaveBeenCalled();
  });
  it("does not switch SDK identities while a purchase is underway", async () => {
    const purchase = deferred();
    const sdk = { logIn: jest.fn().mockResolvedValue(undefined), logOut: jest.fn() };
    const identity = createStoreIdentity(sdk);
    identity.setDesired("a"); await identity.sync();
    const order = identity.run("a", () => purchase.promise);
    await Promise.resolve(); await Promise.resolve();
    identity.setDesired("b"); const changed = identity.sync();
    expect(sdk.logIn.mock.calls).toEqual([["a"]]);
    purchase.resolve(); await order; await changed;
    expect(sdk.logIn.mock.calls).toEqual([["a"], ["b"]]);
  });
  it("recovers after a failed login without accepting a purchase under the wrong UID", async () => {
    const sdk = { logIn: jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined), logOut: jest.fn() };
    const identity = createStoreIdentity(sdk);
    identity.setDesired("a"); await expect(identity.sync()).rejects.toThrow("offline");
    const restored = jest.fn().mockResolvedValue("restored");
    expect(await identity.run("a", restored)).toBe("restored");
    expect(sdk.logIn).toHaveBeenCalledTimes(2);
  });
});
