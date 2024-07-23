console.log('callable-future.js running on', window.location.href);
const CallableFuture = {};

const WaiterResponseType = Object.freeze({
    SUCCESS: "SUCCESS",
    ERROR: "ERROR"
});

class Waiter {
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve; // Assign resolve function to the outer scope variable
            this.reject = reject; // Assign reject function to the outer scope variable
        });
    }
}

class WaiterResponse {
    constructor(type, body) {
        this.type = type;
        this.body = body;
    }
}

CallableFuture.releaseWaiterWithSuccess = function (waiter, response) {
    waiter.resolve(new WaiterResponse(WaiterResponseType.SUCCESS, response));
}

CallableFuture.releaseWaiterWithError = function (waiter, error) {
    waiter.reject(new WaiterResponse(WaiterResponseType.ERROR, error));
}

CallableFuture.waitingHall = new Map();

CallableFuture.addToWaitingHall = function (id) {
    let waiter = new Waiter();
    CallableFuture.waitingHall.set(id, waiter);
    return waiter.promise;
}

CallableFuture.releaseWaiterIfExistsWithSuccess = function (id, response) {
    let waiter = CallableFuture.waitingHall.get(id);
    if (waiter) {
        CallableFuture.releaseWaiterWithSuccess(waiter, response)
        CallableFuture.waitingHall.delete(id);
    }
}

CallableFuture.releaseWaiterIfExistsWithError = function (id, error) {
    let waiter = CallableFuture.waitingHall.get(id);
    if (waiter) {
        CallableFuture.releaseWaiterWithError(waiter, error)
        CallableFuture.waitingHall.delete(id);
    }
}
