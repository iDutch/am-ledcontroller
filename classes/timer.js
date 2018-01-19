module.exports = class Timer {
    constructor(func, wait, times) {
        this.times = times;
        this.wait = wait;
        this.func = func;
        let interv = () => {
            if (typeof this.times === "undefined" || this.times-- > 0) {
                setTimeout(interv, this.wait);
                try {
                    this.func.call(null);
                }
                catch(e) {
                    this.times = 0;
                    throw e.toString();
                }
            }
        };
        setTimeout(interv, this.wait);
    };
    clear() {
        this.times = 0;
    };
};
