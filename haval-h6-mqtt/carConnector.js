const fs = require("fs");
const axios = require("axios");
const https = require("https");
const md5 = require("md5");
const slugify = require("slugify");
const storage = require("./storage");
const carTextUtil = require("./carTextUtil");
const { isTokenExpired, LogType, printLog } = require('./utils');
const { sensorTopics } = require("./map");
const { error } = require("console");

const { USERNAME, PASSWORD, PIN } = process.env;

const Actions = {
    Doors: { OPEN: "1", CLOSE: "2" },
    Windows: { OPEN: "3", CLOSE: "0" },
    SkyWindow: { OPEN: "10", CLOSE: "0" },
    AirCon: { TURN_ON: "1", TURN_OFF: "2" },
    Engine: { TURN_ON: "1", TURN_OFF: "2" },
};

const States = {
    Doors: { OPEN: "1", CLOSED: "0" },
    Windows: { OPEN: "2", PARTIALLY_OPEN: "3", CLOSED: "0" },
    SkyWindow: { CLOSED: "3" },
    AirCon: { ON: "1", OFF: "0" },
    Engine: { ON: "1", OFF: "0" },
};

const Options = {
    Doors: { DOORS: "Doors", TRUNK: "Trunk" },
    Windows: { WINDOWS: "Windows", SKYWINDOW: "SkyWindow" },
    AirCon: { AIRCONDITIONING: "AirConditioning", HEATEDSEATS: "HeatedSeats", STEERINGWHEELHEAT: "SteeringWheelHeat", WINDSHIELDHEAT: "WindshieldHeat", UVC: "UVC", SEATVENTILATION: "SeatVentilation" },
};

const Endpoints = {
    apiVehicle: "https://aus-h5-gateway.gwmcloud.com/app-api/api/v1.0",
    apiLogin: "https://aus-h5-gateway.gwmcloud.com/app-api/api/v1.0/userAuth/loginAccount"
};

const UserMessages = {
    PIN_NOT_CONFIGURED: "Remote command PIN is not configured. Commands cannot run without the PIN set in the MY GWM app.",
    COMMAND_ALREADY_EXECUTING: (description) => `Remote command \"${description}\" is still running. Please wait for it to finish before sending a new command.`,
    COMMAND_SUCCESS: (functionName) => `Remote command for ${functionName} sent successfully.`,
    COMMAND_FAILED: (functionName) => `Failed to send remote command for ${functionName}. Please try again or report the issue to the community.`,
    SYSTEM_BUSY: "Another remote command is already running and the system is busy. Please wait and try again soon.",
    COMMAND_NOT_EXECUTED: (functionName) => `Remote command for ${functionName} was not executed. The vehicle is already in the requested state.`,
    VEHICLE_LOCKED_REQUIRED: (functionName) => `The ${functionName} command can only run while the vehicle is locked. Please lock the vehicle first.`,
    CHARGING_SCHEDULE_REVERSAL: "Charging stop workaround reversal completed successfully.",
    ERROR_SENDING_COMMAND: "An error occurred while sending the command to the vehicle.",
    ERROR_RETRIEVING_CAR_DATA: "Error retrieving vehicle information.",
    ERROR_EXECUTING_COMMAND: (preposition, functionName) => `An error occurred while executing ${preposition} ${functionName}.`,
    ERROR_STOPPING_CHARGING: "Error stopping vehicle charging.",
    ERROR_SETTING_CHARGING: "Error creating a charging schedule.",
    ERROR_AUTHENTICATION: "Authentication error. Please check your credentials.",
    ERROR_AUTHENTICATION_LOG: "Authentication error",
    ERROR_RETRIEVING_CAR_DATA: "Error retrieving vehicle data.",
    ERROR_RETRIEVING_CAR_LIST: "Error retrieving registered vehicle list.",
    ERROR_RETRIEVING_CAR_STATUS: "Error retrieving vehicle status.",
    ERROR_RETRIEVING_COMMAND_STATUS: "Error retrieving last command status.",
    ERROR_FORMATTING_ADDRESS: "Unable to set formatted address for the current location.", 
    ERROR_READING_CERTIFICATES: "Error reading certificate files.",
    ERROR_RETRIEVING_CHARGING_LOGS: "Error retrieving charging logs.",
    UNKNOWN_COMMAND: "Unknown command",    
};

const Services = {
    engineHev: { code: "0x37", description: "Hybrid Engine Control" },
    awayMode: { code: "0x35", description: "Away Mode Activation" },
    chargIn: { code: "0x01", description: "Charging" },
    diagnose: { code: "0x02", description: "Vehicle diagnostics" },
    engine: { code: "0x03", description: "Engine control" },
    airCon: { code: "0x04", description: "Air conditioning control" },
    lockCmdCode: { code: "0x05", description: "Door lock control" },
    searching: { code: "0x06", description: "Find vehicle" },
    light: { code: "0x07", description: "Light control" },
    window: { code: "0x08", description: "Window control" },
    backdoor: { code: "0x09", description: "Tailgate control" },
    batPreheat: { code: "0x10", description: "Battery preheating" },
    pluggedIn: { code: "0x18", description: "Charging status" },
    activeHeat: { code: "0x18", description: "Active heating" },
    cabinClean: { code: "0x11", description: "Cabin air cleaning" },
    idleCharging: { code: "0x12", description: "Charging standby control" },
    seat: { code: "0x0A", description: "Seat ventilation and heating control" },
    defrostCode: { code: "0x0B", description: "Defrost control" },
    clearAir: { code: "0x0C", description: "Air purification control" },
    locationAuthorization: { code: "0xCF", description: "Location authorization" },
    removeWarning: { code: "0x16", description: "Clear warnings" },
    steeringWheelHeat: { code: "0x19", description: "Steering wheel heating" },
    acFrontWinHeat: { code: "0x2A", description: "Windshield heating" },
    acUVCDisinfectionLight: { code: "0x25", description: "UV disinfection light" },
    chargingControl: { code: "0x01", description: "Charging control" },
    uvSanitizer: { code: "0x1F", description: "UV sanitizer" },
    slindingDoor: { code: "0x22", description: "Sliding door control" },
};

async function auth() {
  let { accessToken, refreshToken } = "";

  accessToken = storage.getItem("accessToken");
  refreshToken = storage.getItem("refreshToken");

  if (accessToken && !isTokenExpired(accessToken))
    return { accessToken, refreshToken };

  const deviceid = storage.getItem("deviceid") ? storage.getItem("deviceid") : md5(Math.random().toString());
  storage.setItem("deviceid", deviceid);

    const loginAttempts = [
        {
            account: USERNAME,
            agreement: [1, 2, 23],
            appType: 0,
            country: "5",
            deviceId: deviceid,
            isEncrypt: false,
            model: "hassio-haval-h6-to-mqtt",
            password: PASSWORD,
            pushToken: "",
            type: 1,
        },
        {
            account: USERNAME,
            agreement: [1, 2, 23],
            appType: 0,
            country: "5",
            deviceId: deviceid,
            isEncrypt: false,
            model: "hassio-haval-h6-to-mqtt",
            password: md5(PASSWORD),
            pushToken: "",
            type: 1,
        },
        {
            account: USERNAME,
            agreement: [1, 2, 23],
            appType: 0,
            country: "AU",
            deviceId: deviceid,
            isEncrypt: false,
            model: "hassio-haval-h6-to-mqtt",
            password: PASSWORD,
            pushToken: "",
            type: 1,
        },
        {
            deviceid,
            password: md5(PASSWORD),
            account: USERNAME,
        },
    ];

  const userHeaders = {
    appid: "6",
    brand: "6",
    brandid: "CCZ001",
        country: "AU",
    devicetype: "0",
    enterpriseid: "CC01",
    gwid: "",
        language: "en_AU",
        rs: "2",
        terminal: "GW_APP_GWM",
        systemType: "2",
        cver: "",
  };

    let lastError = null;
    for (const params of loginAttempts) {
        try {
            const { data } = await axios.post(Endpoints.apiLogin, params, { headers: userHeaders });

            if (data.description === "SUCCESS") {
                Object.keys(data.data).forEach((key) => {
                    if(key === "accessToken")
                            accessToken = data.data[key];

                    if(key === "refreshToken")
                            refreshToken = data.data[key];
                });
                return { accessToken, refreshToken };
            }

            lastError = data;
        } catch (err) {
            lastError = err.response?.data || err;
    }
    }

    printLog(LogType.ERROR, `---${UserMessages.ERROR_AUTHENTICATION_LOG}---`, lastError);
    throw new Error(UserMessages.ERROR_AUTHENTICATION);
};

let headers = {}

async function updateHeaders() {
    if (headers.accessToken && axios.defaults.httpsAgent)
        return;
    let { certData, certKey, ca } = "";
    try {
        certData = fs.readFileSync("./certs/gwm_general.cer", { encoding: "utf8" });
        certKey = fs.readFileSync("./certs/gwm_general.key", { encoding: "utf8" });
        ca = fs.readFileSync("./certs/gwm_root.cer", { encoding: "utf8" });
    }
    catch (error) {
        printLog(LogType.ERROR, UserMessages.ERROR_READING_CERTIFICATES, error);
        return null;
    }

    const httpsAgent = new https.Agent({
        cert: certData,
        ca: ca,
        key: certKey,
        rejectUnauthorized: false,
        ciphers: "DEFAULT:@SECLEVEL=0",
    });

    axios.defaults.httpsAgent = httpsAgent;

    const { accessToken, refreshToken } = await auth();

    headers = {
        rs: "2",
        terminal: "GW_APP_GWM",
        brand: "6",
        language: "en_AU",
        systemType: "2",
        cver: "",
        regioncode: "AU",
        country: "AU",
        accessToken: accessToken,
        refreshToken: refreshToken
    };
}

async function getLastCommandResult(seqNo, vin) {
    try {
        const { data } = await axios.get(
            `${Endpoints.apiVehicle}/vehicle/getRemoteCtrlResultT5?seqNo=${seqNo}&vin=${vin}`,
            { headers }
        );

        if (data && data.data && data.description === "SUCCESS") {
            return {
                remoteType: data.data[0].remoteType,
                resultCode: data.data[0].resultCode,
            };
        }
        return null;
    } catch (e) {
        printLog(LogType.ERROR, `---${UserMessages.ERROR_RETRIEVING_COMMAND_STATUS}---`, e);
        return null;
    }
}

async function sendCmd (instructions, vin) {
    try {
        if(PIN === undefined || PIN === "")
            return { code:"9999", message: UserMessages.PIN_NOT_CONFIGURED }

        const currentTime = Date.now();
        const _timeout = 60000;

        let lastCommands = {};
        try {
            lastCommands = JSON.parse(storage.getItem("lastCommands") || "{}");
        } catch (e) {
            lastCommands = {};
        }
        if (!lastCommands[vin])
            lastCommands[vin] = { seqNo: null, timestamp: null };

        const lastCommand = lastCommands[vin];

        if (lastCommand.seqNo && (currentTime - lastCommand.timestamp) < _timeout) {
            let lastResult = {};
            lastResult = await getLastCommandResult(lastCommand.seqNo, vin);

            if (lastResult) {
                if(!['6', '10'].includes(lastResult.resultCode)) {
                    const service = Object.values(Services).find(s => s.code === lastResult.remoteType);
                    const description = service ? service.description : UserMessages.UNKNOWN_COMMAND;
                    return {
                        result: false,
                        message: `${UserMessages.COMMAND_ALREADY_EXECUTING(description)} - (${lastResult.resultCode})`,
                        running: true
                    };
                }
            }
        }

        const seqNo = require('crypto').randomUUID().replaceAll('-', '') + '1234';
        lastCommands[vin] = { seqNo, timestamp: currentTime };
        storage.setItem("lastCommands", JSON.stringify(lastCommands));

        const options = { headers };    
        const remoteType = 0;
        const securityPassword = md5(PIN);
        const type = 2;

        await updateHeaders();

        const res = await axios.post(
            `${Endpoints.apiVehicle}/vehicle/T5/sendCmd`,
            {
                instructions,
                remoteType, 
                securityPassword,
                seqNo,
                type,
                vin
            },
            options
        );

        return res.data;
    } catch (err) {
        printLog(LogType.ERROR, `---${UserMessages.ERROR_SENDING_COMMAND}---`, err);
        return {
            result: false,
            message: UserMessages.ERROR_SENDING_COMMAND
        };
    }
};

async function chargingSchedule(enable, vin) {
    try {
        if(PIN === undefined || PIN === "")
            return { code:"9999", message: UserMessages.PIN_NOT_CONFIGURED }
    
        const seqNo = require('crypto').randomUUID().replaceAll('-', '') + '1234';  
        const startTimeAdd = 5 * 60 * 1000;
        const endTimeAdd = 6 * 60 * 1000;
        const startTime = new Date().getTime() + startTimeAdd;
        const endTime = new Date().getTime() + endTimeAdd;
    
        let options = {
        headers,
        };   
    
        const body = {
            enable: enable,
            startTime: enable ? startTime : "",
            endTime: enable ? endTime : "",
            seqNo: seqNo,
            planType: "1",
            vin: vin
        };
    
        const res = await axios.post(
            `${Endpoints.apiVehicle}/vehicleCharge/setChargingPlan?vin=${vin}`,
            body,
            options
        );
    
        return res.data;
    } catch (e) {
        printLog(LogType.ERROR, `---${UserMessages.ERROR_SETTING_CHARGING}---`, e);
        return false;
    }
}

function apiReturnHandle(returnData, functionName){
    if(returnData && returnData.description === "SUCCESS") {
        return { result: true, message: UserMessages.COMMAND_SUCCESS(functionName.toString()) };
    }
    else if(returnData) {
        if(returnData.running === true || (returnData.code && returnData.code === "9999"))
            return { result: false, message: returnData.message};
        
        if(returnData.code && returnData.code === "REMOTE250502")
            return { result: false, message: UserMessages.SYSTEM_BUSY};
        
        if(returnData.result === false){
            printLog(LogType.ERROR, `---${UserMessages.ERROR_EXECUTING_COMMAND("de", functionName.toString())}--- `, returnData);
            return { result: false, message: returnData.message, error: true};
        }
    }
    else{
        let errorCode = "";
        if(returnData.code)
            errorCode = returnData.code;
        printLog(LogType.INFO, `---${UserMessages.ERROR_EXECUTING_COMMAND("de", functionName.toString())}---`, errorCode);
        return { result: false, message: UserMessages.COMMAND_FAILED(functionName.toString()), error: true};
    }
}

const carData = {
    async getCarList() {
        try {
            await updateHeaders();
            return await axios.get(`${Endpoints.apiVehicle}/globalapp/vehicle/acquireVehicles`, { headers });
            
        } catch(e) {
            printLog(LogType.ERROR, `---${UserMessages.ERROR_RETRIEVING_CAR_DATA}---`, e.Message);
        }
    },
    async getCarInfo(vin) {
        try {
            await updateHeaders();
            const { data } = await axios.get(`${Endpoints.apiVehicle}/vehicle/getLastStatus?vin=${String(vin).toUpperCase()}&flag=true`, { headers });
            return data.data;
        } catch (e) {
            printLog(LogType.ERROR, `---${UserMessages.ERROR_RETRIEVING_CAR_LIST}---`, e.Message);
        }
    },    
    async getStatus(vin) {        
        try{
            await updateHeaders();
            const data = await carData.getCarInfo(vin);

            let status = {};

            if (data && data.items) {
                data.items.forEach(({ code, value }) => {
                    if (sensorTopics.hasOwnProperty(code)) {
                        const topicInfo = sensorTopics[code];
                        status[slugify(topicInfo.description.replace(/[\(\)-]/g, '').toLowerCase(), "_")] = {
                            ...topicInfo,
                            value: value
                        };
                    }
                });

                if(data.hasOwnProperty("hyEngSts")) {
                    const topicInfo = {
                                        code: "hyEngSts",
                                        description: "Estado do Motor",
                                        entity_type: "sensor",
                                        value: `${data.hyEngSts ? data.hyEngSts : '0'}`,
                                        icon: "mdi:engine",
                                        state_on: "1",
                                        state_off: "0"
                                      };
                    status[slugify(topicInfo.description.replace(/[\(\)-]/g, '').toLowerCase(), "_")] = { 
                        ...topicInfo, 
                        value: `${data.hyEngSts}` 
                    };
                }
            }
            return status;
        }catch(e){
            printLog(LogType.ERROR, `---${UserMessages.ERROR_RETRIEVING_CAR_STATUS}---`, e);
            return UserMessages.ERROR_RETRIEVING_CAR_STATUS
        }
    },
    async getChargingLogs(vin) {
      try {
        await updateHeaders();

        const body = {
          vin: vin.toUpperCase(),
          pageNum: "1",
          pageSize: "100",
          continuation: "0"    
        };
    
        const chargingLogs = await axios.post(`${Endpoints.apiVehicle}/vehicleCharge/getChargeLogs`, body, { headers });
        
        if(chargingLogs && chargingLogs.data && chargingLogs.data.data.list && chargingLogs.data.data.list.length > 0) {
          const formattedList = chargingLogs.data.data.list.map(({ startTime, endTime }) => {
            const startDate = new Date(parseInt(startTime)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            const endDate = new Date(parseInt(endTime)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
          
            const startTimeFormatted = new Date(parseInt(startTime)).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
            const endTimeFormatted = new Date(parseInt(endTime)).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
          
            return `${startDate} ${startTimeFormatted} ~ ${endDate} ${endTimeFormatted}`;
          });
          
          return formattedList;
        }
        else
          return "";

      } catch (e) {
        printLog(LogType.ERROR, `---${UserMessages.ERROR_RETRIEVING_CHARGING_LOGS}---`, e.message);
        return "";
      }
    }
}

const carUtil = {
    async airConditioner(action, vin) {
        const actualStatus = await carData.getStatus(vin);
        let airConAction = "";

        if(actualStatus && actualStatus["estado_do_ar_condicionado"]){
            if((action === Actions.AirCon.TURN_OFF && actualStatus["estado_do_ar_condicionado"].value === States.AirCon.OFF)
             ||(action === Actions.AirCon.TURN_ON  && actualStatus["estado_do_ar_condicionado"].value === States.AirCon.ON)){
                return { result: false, message: UserMessages.COMMAND_NOT_EXECUTED("ar-condicionado")};
            }
            if(actualStatus["estado_da_trava"].value !== States.Doors.CLOSED) {
                return { result: false, message: UserMessages.VEHICLE_LOCKED_REQUIRED("ar-condicionado")};
            }
            airConAction = action;
        }
        else
            airConAction = Actions.AirCon.TURN_OFF;

        try{
            const acData = await sendCmd({
                                          [Services.airCon.code]: {
                                              "airConditioner": {
                                                  "operationTime": "15",
                                                  "switchOrder": airConAction,
                                                  "temperature": "18"
                                              }
                                          }
                                         }, vin);

            return apiReturnHandle(acData, "ar-condicionado");
        }catch(e){
            printLog(LogType.ERROR, UserMessages.ERROR_EXECUTING_COMMAND({preposition: "do",  functionName: "ar-condicionado" }), e);
            return { result: false, message: UserMessages.ERROR_EXECUTING_COMMAND({preposition: "do",  functionName: "ar-condicionado" }) };
        }
    },
    async engine(action, vin) {
        const actualStatus = await carData.getStatus(vin);
        if(actualStatus["estado_da_trava"].value !== States.Doors.CLOSED) {
            return { result: false, message: UserMessages.VEHICLE_LOCKED_REQUIRED("motor")};
        }

        if((action === Actions.Engine.TURN_OFF && actualStatus["estado_do_motor"].value === States.Engine.OFF)
         ||(action === Actions.Engine.TURN_ON  && actualStatus["estado_do_motor"].value === States.Engine.ON)){
            return { result: false, message: UserMessages.COMMAND_NOT_EXECUTED("motor")};
        }

        try{
            const engineData = await sendCmd({
                                          [Services.engine.code]: {
                                              "operationTime": "15",
                                              "switchOrder": action
                                          }
                                         }, vin);

            return apiReturnHandle(engineData, "motor");
        }catch(e){
            printLog(LogType.ERROR, UserMessages.ERROR_EXECUTING_COMMAND({preposition: "do",  functionName: "motor" }), e);
            return { result: false, message: UserMessages.ERROR_EXECUTING_COMMAND({preposition: "do",  functionName: "motor" }), error: true };
        }
    },
    async windows_skyWindow(action, windowsOption, vin) {
        const actualStatus = await carData.getStatus(vin);
        let windowsAction = "";
        let skyWindowAction = "";

        if(windowsOption === Options.Windows.WINDOWS){
            if(actualStatus 
               && actualStatus["vidro_dianteiro_esquerdo"]
               && actualStatus["vidro_dianteiro_direito"]
               && actualStatus["vidro_traseiro_esquerdo"]
               && actualStatus["vidro_traseiro_direito"]) {

                const actualWindowsState =  actualStatus["vidro_dianteiro_esquerdo"].value
                                          + actualStatus["vidro_dianteiro_direito"].value
                                          + actualStatus["vidro_traseiro_esquerdo"].value
                                          + actualStatus["vidro_traseiro_direito"].value;

                if ((action === Actions.Windows.CLOSE && !actualWindowsState.includes(States.Windows.OPEN) && !actualWindowsState.includes(States.Windows.PARTIALLY_OPEN))
                  ||(action === Actions.Windows.OPEN  && actualWindowsState.includes(States.Windows.CLOSED))){
                    return { result: false, message: UserMessages.COMMAND_NOT_EXECUTED("janelas")};
                }

                windowsAction = action;

                windowsAction = actualWindowsState.includes(States.Windows.OPEN) || actualWindowsState.includes(States.Windows.PARTIALLY_OPEN) ? Actions.Windows.CLOSE : Actions.Windows.OPEN;
            }
            else
                windowsAction = Actions.Windows.CLOSE;
        }        

        if(windowsOption === Options.Windows.SKYWINDOW){
            if(actualStatus && actualStatus["posicao_do_teto_solar"]){
                if ((action === Actions.SkyWindow.CLOSE && actualStatus["posicao_do_teto_solar"].value === States.SkyWindow.CLOSED)
                  ||(action === Actions.SkyWindow.OPEN  && actualStatus["posicao_do_teto_solar"].value !== States.SkyWindow.CLOSED)){
                    return { result: false, message: UserMessages.COMMAND_NOT_EXECUTED("teto solar")};
                }
                skyWindowAction = action;
            }
            else
                skyWindowAction = Actions.SkyWindow.CLOSE;
        }

        try{
            const windowData = await sendCmd({
                                              [Services.window.code]: {
                                                  "switchOrder": "0",
                                                  "window": {
                                                      "leftFront": windowsAction,
                                                      "leftBack": windowsAction,
                                                      "rearFront": windowsAction,
                                                      "rearBack": windowsAction,
                                                      "skyLight": skyWindowAction
                                                  }
                                              }
                                             }, vin);
            
            return apiReturnHandle(windowData, windowsOption === Options.Windows.SKYWINDOW ? "teto solar" : "janelas");
        }catch(e){
            printLog(LogType.ERROR, `---${UserMessages.ERROR_EXECUTING_COMMAND({preposition: "das",  functionName: Options.Windows.SKYWINDOW ? "teto solar" : "janelas" })}---`, e);
            return { result: false, message: UserMessages.ERROR_EXECUTING_COMMAND({preposition: "das",  functionName: Options.Windows.SKYWINDOW ? "teto solar" : "janelas" }), error: true};
        }
    },
    async windows(action, vin) {
        return this.windows_skyWindow(action, Options.Windows.WINDOWS, vin);
    },
    async skyWindow(action) {
        return this.windows_skyWindow(action, Options.Windows.SKYWINDOW, vin);
    },
    async doors_trunk(action, doorsOption, vin) {
        const actualStatus = await carData.getStatus(vin);
        let doorsAction = "";
        const serviceCode = doorsOption === Options.Doors.TRUNK ? Services.backdoor.code : Services.lockCmdCode.code;

        if (actualStatus) {
            const lockState = doorsOption === Options.Doors.TRUNK ? actualStatus["portamalas"] : actualStatus["estado_da_trava"];

            if (lockState) {
            if ((action === Actions.Doors.CLOSE && lockState.value === States.Doors.CLOSED)
             || (action === Actions.Doors.OPEN  && lockState.value === States.Doors.OPEN)) {
                return { result: false, message: UserMessages.COMMAND_NOT_EXECUTED(doorsOption === Options.Doors.TRUNK ? "porta-malas" : "portas")};
            }
            doorsAction = action;
            } else {
            doorsAction = Actions.Doors.CLOSE;
            }
        } else {
            doorsAction = Actions.Doors.CLOSE;
        }

        try {
            const doorData = await sendCmd({
                                            [serviceCode]: {
                                                "operationTime": "0",
                                                "switchOrder": doorsAction
                                            }
                                           }, vin);

            return apiReturnHandle(doorData, doorsOption === Options.Doors.TRUNK ? "porta-malas" : "portas");
        } catch (e) {
            printLog(LogType.ERROR, `---${UserMessages.ERROR_EXECUTING_COMMAND({preposition: doorsOption === Options.Doors.TRUNK ? "do" : "das",  functionName: doorsOption === Options.Doors.TRUNK ? "porta-malas" : "portas" })}---`, e);
            return { result: false, message: UserMessages.ERROR_EXECUTING_COMMAND({preposition: doorsOption === Options.Doors.TRUNK ? "do" : "das",  functionName: doorsOption === Options.Doors.TRUNK ? "porta-malas" : "portas" }), error: true };
        }
    },
    async doors(action, vin) {
        return this.doors_trunk(action, Options.Doors.DOORS, vin);
    },
    async trunk(action, vin) {
        return this.doors_trunk(action, Options.Doors.TRUNK, vin);
    },
    async stopCharging(vin) {
        await chargingSchedule(true);
        setTimeout(async () => { 
            await chargingSchedule(false, vin);
            printLog(LogType.INFO, `>>>${UserMessages.CHARGING_SCHEDULE_REVERSAL}<<<`);
        }, 2 * 60 * 1000);
    }
}

module.exports = { carData, carUtil, Actions, States, Options, auth, carTextUtil, UserMessages };