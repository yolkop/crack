// ==UserScript==
// @name        ssJS replacer
// @match       *://shellshock.io/*
// @version     1
// @run-at      document-start
// @grant       none
// ==/UserScript==

let _loadJS = Loader.prototype.constructor.loadJS;

Loader.prototype.constructor.loadJS = (path, callback) => {
    if (path.includes('shellshock.js')) {
        const s = document.createElement('script');
        s.src = 'http://localhost:6056/shellshock.js';
        document.head.appendChild(s);

        s.onload = () => {
            import('/js/wasm_loader.js?6').then(({
                init,
                validate,
                get_yaw_pitch,
                reset_yaw_pitch,
                set_mouse_params,
                poll_gamepad
            }) => {
                window.validate = validate;
                window.get_yaw_pitch = get_yaw_pitch;
                window.reset_yaw_pitch = reset_yaw_pitch;
                window.set_mouse_params = set_mouse_params;
                window.poll_gamepad = poll_gamepad;

                init().then(() => callback());
            });
        }

        return;
    }

    return _loadJS(path, callback);
}