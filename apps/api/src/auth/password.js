"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
// Password hashing — scrypt with per-hash salt. Stored as scrypt$N$r$p$salt$hash (all hex/b64).
var node_crypto_1 = require("node:crypto");
var node_util_1 = require("node:util");
var scrypt = (0, node_util_1.promisify)(node_crypto_1.scrypt);
var N = 16384, r = 8, p = 1, KEYLEN = 32;
function hashPassword(plain) {
    return __awaiter(this, void 0, void 0, function () {
        var salt, dk;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    salt = (0, node_crypto_1.randomBytes)(16);
                    return [4 /*yield*/, scrypt(plain, salt, KEYLEN, { N: N, r: r, p: p })];
                case 1:
                    dk = _a.sent();
                    return [2 /*return*/, "scrypt$".concat(N, "$").concat(r, "$").concat(p, "$").concat(salt.toString('base64'), "$").concat(dk.toString('base64'))];
            }
        });
    });
}
function verifyPassword(plain, stored) {
    return __awaiter(this, void 0, void 0, function () {
        var parts, n, rr, pp, saltB64, hashB64, salt, expected, dk;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    parts = stored.split('$');
                    if (parts.length !== 6 || parts[0] !== 'scrypt')
                        return [2 /*return*/, false];
                    n = parts[1], rr = parts[2], pp = parts[3], saltB64 = parts[4], hashB64 = parts[5];
                    salt = Buffer.from(saltB64, 'base64');
                    expected = Buffer.from(hashB64, 'base64');
                    return [4 /*yield*/, scrypt(plain, salt, expected.length, { N: +n, r: +rr, p: +pp })];
                case 1:
                    dk = _a.sent();
                    return [2 /*return*/, dk.length === expected.length && (0, node_crypto_1.timingSafeEqual)(dk, expected)];
            }
        });
    });
}
