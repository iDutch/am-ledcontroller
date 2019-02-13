module.exports = class Timer {
    constructor(func, wait, useInterval, times) {
        this.times = times;
        this.wait = wait;
        this.func = func;
        this.setInterval = null;
        if (useInterval === true) {
            this.setInterval = setInterval(() => {
                this.func.call(null);
            }, this.wait);
        } else {
            let interval = () => {
                if (typeof this.times === "undefined" || this.times-- > 0) {
                    setTimeout(interval, this.wait);
                    try {
                        this.func.call(null);
                    }
                    catch(e) {
                        this.times = 0;
                        throw e.toString();
                    }
                }
            };
            setTimeout(interval, this.wait);
        }

    };
    clear() {
        this.times = 0;
        this.setInterval = null;
    };
};
