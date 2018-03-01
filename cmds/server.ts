/// <reference path="faye-websocket.d.ts"/>
/// <reference path="../types.d.ts" />

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import childProcess = require('child_process');

const log = console.log;
const debug = console.debug;

/*******************
 * 
 * Johnny Five RPC wrapper
 * 
 */
const five = require('johnny-five')

/**
 * A wrapper for a five.Board instance
 */
class J5Board {
    private components: pxt.Map<any>;

    constructor(private board: any) {

    }

    component(name: string, args: any[]): J5Component {
        const id = JSON.stringify({ name, args });
        let component = this.components[id];
        if (!component) {
            debug(`j5: new ${name}(${args.map(a => a + "").join(',')})`)
            component = this.components[id] = new J5Component(new five[id](args));
        }
        return component;
    }
}

/**
 * A wrapper for a five component like an LED
 */
class J5Component {
    constructor(private component: any) {

    }

    call(name: string, args: any[]): any {
        debug(`j5: call ${name}(${args.map(a => a + "").join(',')})`)
        const proto = Object.getPrototypeOf(this.component);
        const fn = proto[name];
        args.unshift(this.component);
        return fn.apply(args);
    }
}

let boards: pxt.Map<Promise<J5Board>> = {}; // five.Board

function sendResponse(resp: j5.Response) {
    const msg = JSON.stringify(resp);
    editors.forEach(editor => editor.send(msg));
}

/**
 * connects to a given board
 * @param id board identitifer
 */
function boardAsync(id: string): Promise<J5Board> {
    let board = boards[id];
    if (!board) {
        log(`j5: connecting board ${id}`)
        // need to connect
        board = boards[id] = new Promise((resolve, reject) => {
            const b = new five.Board();
            b.on("ready", () => {
                debug(`j5: board ${id} connected`)
                resolve(new J5Board(b));
            })
            b.on("error", () => {
                delete boards[id];
                reject(new Error(`board ${id} not found`))
            });
        });
    }
    return board;
}

function handleError(req: j5.Request, error: any) {
    log(error);
    sendResponse(<j5.ErrorResponse>{
        req,
        status: 500,
        error
    })
}

function handleConnect(req: j5.ConnectRequest) {
    boardAsync(req.board)
        .then(() => {
            sendResponse({
                req,
                status: 200
            })
        })
        .catch(e => handleError(req, e));
}

function handleRpc(req: j5.RPCRequest) {
    boardAsync(req.board)
        .then(b => b.component(req.component, req.componentArgs || []))
        .then(c => c.call(req.function, req.functionArgs || []))
        .then(resp => sendResponse(<j5.RPCResponse>{
            req,
            status: 200,
            resp
        }))
        .catch(e => handleError(req, e));
}

function handleRequest(req: j5.Request) {
    log(`j5: req ${req.type}`)
    switch (req.type) {
        case "connect":
            handleConnect(req as j5.ConnectRequest);
            break;
        case "rpc":
            handleRpc(req as j5.RPCRequest);
            break;
    }
}


// web socket connection to editor(s)
const WebSocket = <any>require('faye-websocket');
const wsserver = http.createServer();
const editors: WebSocket[] = [];
function startws(request: any, socket: any, body: any) {
    log(`j5: connecting client...`);
    let ws = new WebSocket(request, socket, body);
    editors.push(ws);
    ws.on('message', function (event: any) {
        handleRequest(JSON.parse(event.data) as j5.Request);
    });
    ws.on('close', function (event: any) {
        log('j5: connection closed')
        editors.splice(editors.indexOf(ws), 1)
        ws = null;
    });
    ws.on('error', function () {
        log('j5: connection closed')
        editors.splice(editors.indexOf(ws), 1)
        ws = null;
    })
}

log('j5: starting...')
wsserver.on('upgrade', function (request: any, socket: any, body: any) {
    if (WebSocket.isWebSocket(request))
        startws(request, socket, body)
});

const port = 3074;
const address = "localhost";
wsserver.listen(port);
log(`j5: web socket server from ${address}:${port}/`);
