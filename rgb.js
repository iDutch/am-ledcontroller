const pigpio = require('pigpio');
const Gpio = pigpio.Gpio;

let heater = new Gpio(23, {mode: Gpio.INPUT});
let co2 = new Gpio(16, {mode: Gpio.INPUT});
//let led = new Gpio(19, {mode: Gpio.OUTPUT});

//led.pwmWrite(250);
//heater.digitalWrite(0);
co2.digitalWrite(0);
while(1) {

}
