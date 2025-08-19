const ProtectionType = Object.freeze({
    PASSWORD: 'pPassword',
    CAPTCHA: 'pCaptcha'
});

const protectWithPasswordChoice = document.getElementById("protectWithPasswordChoice");
const protectWithCaptchaChoice = document.getElementById("protectWithCaptchaChoice");
const passwordInputContainer = document.getElementById("passwordInputContainer");
const passwordInput = document.getElementById("passwordInput");

function setProtectionTypeChoice(choiceName) {
    if (choiceName === ProtectionType.PASSWORD) {
        protectWithPasswordChoice.checked = true;
        protectWithCaptchaChoice.checked = false;
        passwordInputContainer.style.display = 'block';
        passwordInput.focus();
    } else if (choiceName === ProtectionType.CAPTCHA) {
        protectWithCaptchaChoice.checked = true;
        protectWithPasswordChoice.checked = false;
        passwordInputContainer.style.display = 'none';
    }
}

function getProtectionAttributes() {
    if (protectWithPasswordChoice.checked && (passwordInput.value.trim() !== "")) {
        return {
            type: ProtectionType.PASSWORD,
            pwd: passwordInput.value
        };
    } else if (protectWithCaptchaChoice.checked) {
        return {
            type: ProtectionType.CAPTCHA
        };
    } else {
        return null;
    }
}

document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('input[name="protectWithPasswordChoice"]').forEach((element) => {
        element.addEventListener('change', function () {
            setProtectionTypeChoice(this.value);
        });
    });
    document.querySelectorAll('input[name="protectWithCaptchaChoice"]').forEach((element) => {
        element.addEventListener('change', function () {
            setProtectionTypeChoice(this.value);
        });
    });
});

