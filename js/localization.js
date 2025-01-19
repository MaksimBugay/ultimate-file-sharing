const translations = {
    destinationHintString: {
        en: "Please open OUR SITE on receiver's device and enter virtual host name assigned to receiver",
        es: "Por favor, abra NUESTRO SITIO en el dispositivo del receptor e ingrese el nombre de host virtual asignado al receptor",
        fr: "Veuillez ouvrir NOTRE SITE sur l'appareil du récepteur et entrer le nom d'hôte virtuel assigné au récepteur",
        de: "Bitte öffnen Sie UNSERE SEITE auf dem Gerät des Empfängers und geben Sie den dem Empfänger zugewiesenen virtuellen Hostnamen ein",
        zh: "请在接收设备上打开我们的网站并输入分配给接收方的虚拟主机名",
        ru: "Пожалуйста, откройте НАШ САЙТ на устройстве получателя и введите имя виртуального хоста, назначенное получателю",
        ja: "受信者のデバイスで当サイトを開き、受信者に割り当てられた仮想ホスト名を入力してください",
        it: "Per favore, apri IL NOSTRO SITO sul dispositivo del destinatario e inserisci il nome host virtuale assegnato al destinatario",
        pt: "Por favor, abra NOSSO SITE no dispositivo do receptor e insira o nome do host virtual atribuído ao receptor",
        ar: "يرجى فتح موقعنا على جهاز المستلم وإدخال اسم المضيف الافتراضي المخصص للمستلم",
        hi: "कृपया रिसीवर के डिवाइस पर हमारी साइट खोलें और रिसीवर को सौंपा गया वर्चुअल होस्ट नाम दर्ज करें",
        ko: "수신자의 기기에서 우리의 사이트를 열고 수신자에게 할당된 가상 호스트 이름을 입력하세요",
        tr: "Lütfen alıcının cihazında SİTEMİZİ açın ve alıcıya atanmış sanal ana bilgisayar adını girin",
        nl: "Open alstublieft ONZE SITE op het apparaat van de ontvanger en voer de toegewezen virtuele hostnaam in",
        sv: "Vänligen öppna VÅR WEBBPLATS på mottagarens enhet och ange det virtuella värdnamnet som tilldelats mottagaren",
        pl: "Proszę otworzyć NASZĄ STRONĘ na urządzeniu odbiorcy i wprowadzić przypisaną odbiorcy nazwę wirtualnego hosta",
        vi: "Vui lòng mở TRANG WEB CỦA CHÚNG TÔI trên thiết bị của người nhận và nhập tên máy chủ ảo được gán cho người nhận",
        id: "Silakan buka SITUS KAMI di perangkat penerima dan masukkan nama host virtual yang ditetapkan ke penerima",
        th: "กรุณาเปิดเว็บไซต์ของเราบนอุปกรณ์ของผู้รับ และป้อนชื่อโฮสต์เสมือนที่กำหนดให้กับผู้รับ",
        uk: "Будь ласка, відкрийте НАШ САЙТ на пристрої отримувача та введіть віртуальне ім'я хоста, призначене отримувачу",
        ms: "Sila buka LAMAN WEB KAMI pada peranti penerima dan masukkan nama hos maya yang ditetapkan kepada penerima",
        tl: "Pakibuksan ang AMING SITE sa device ng tatanggap at ilagay ang virtual host name na itinalaga sa tatanggap",
        fa: "لطفاً وب‌سایت ما را در دستگاه گیرنده باز کنید و نام میزبان مجازی اختصاص داده‌شده به گیرنده را وارد کنید",
        ro: "Vă rugăm să deschideți SITE-UL NOSTRU pe dispozitivul receptorului și să introduceți numele de gazdă virtual atribuit receptorului",
        hu: "Kérjük, nyissa meg a WEBOLDALUNKAT a vevő eszközén, és adja meg a vevőhöz rendelt virtuális gazdagép nevét",
        cs: "Otevřete prosím NAŠI STRÁNKU na zařízení příjemce a zadejte virtuální název hostitele přiřazený příjemci",
        el: "Παρακαλώ ανοίξτε τον ΙΣΤΟΤΟΠΟ ΜΑΣ στη συσκευή του παραλήπτη και εισαγάγετε το εικονικό όνομα υποδοχής που έχει εκχωρηθεί στον παραλήπτη",
        da: "Åbn venligst VORES HJEMMESIDE på modtagerens enhed og indtast det virtuelle værtsnavn tildelt modtageren",
        fi: "Avaa SIVUMME vastaanottajan laitteessa ja kirjoita vastaanottajalle osoitettu virtuaalinen isäntänimi",
        no: "Vennligst åpne VÅR SIDE på mottakerens enhet og skriv inn det virtuelle vertsnavnet som er tildelt mottakeren"
    },
    deviceCaptionHintString: {
        en: "your assigned virtual host name",
        es: "tu nombre de host virtual asignado",
        fr: "votre nom d'hôte virtuel attribué",
        de: "Ihr zugewiesener virtueller Hostname",
        zh: "您分配的虚拟主机名",
        ru: "ваше назначенное имя виртуального хоста",
        ja: "割り当てられた仮想ホスト名",
        it: "il tuo nome host virtuale assegnato",
        pt: "seu nome de host virtual atribuído",
        ar: "اسم المضيف الافتراضي الخاص بك المخصص",
        hi: "आपका सौंपा गया वर्चुअल होस्ट नाम",
        ko: "할당된 가상 호스트 이름",
        tr: "atanmış sanal ana bilgisayar adınız",
        nl: "uw toegewezen virtuele hostnaam",
        sv: "ditt tilldelade virtuella värdnamn",
        pl: "twoja przypisana nazwa wirtualnego hosta",
        vi: "tên máy chủ ảo được chỉ định của bạn",
        id: "nama host virtual Anda yang ditetapkan",
        th: "ชื่อโฮสต์เสมือนที่คุณได้รับมอบหมาย",
        uk: "ваше призначене ім'я віртуального хоста",
        ms: "nama hos maya anda yang ditugaskan",
        tl: "ang iyong itinalagang pangalan ng virtual host",
        fa: "نام میزبان مجازی تعیین‌شده شما",
        ro: "numele de gazdă virtual atribuit",
        hu: "az Ön számára kijelölt virtuális gazdagép neve",
        cs: "vaše přidělené jméno virtuálního hostitele",
        el: "το εκχωρημένο όνομα εικονικού κεντρικού υπολογιστή σας",
        da: "dit tildelte virtuelle værtsnavn",
        fi: "sinulle osoitettu virtuaalinen isäntänimi",
        no: "ditt tildelte virtuelle vertsnavn"
    }
};

let userLang = navigator.language.slice(0, 2);

userLang = translations.destinationHintString[userLang] ? userLang : 'en';

function localizePage(lang) {
    const destinationHint = document.getElementById("destinationHint");
    if (destinationHint) {
        destinationHint.innerText = translations.destinationHintString[lang] || translations.destinationHintString['en'];
    }

    const deviceCaptionHint = document.getElementById('deviceCaptionHint');
    if (deviceCaptionHint) {
        deviceCaptionHint.innerText = translations.deviceCaptionHintString[lang] || translations.deviceCaptionHintString['en'];
    }
}

localizePage(userLang);

const dropdownList = document.getElementById('dropdownList');
const dropdown = document.getElementById('languageDropdown');
const dropdownButton = document.getElementById('dropdownButton');
Object.keys(translations.deviceCaptionHintString).forEach(langCode => {
    const li = document.createElement('li');
    li.setAttribute('data-lang', langCode);
    li.innerHTML = `${getCountryFlagImage(langCode)} ${langCode.toUpperCase()}`;
    dropdownList.appendChild(li);

    if (langCode === userLang) {
        dropdownButton.innerHTML = li.innerHTML;
        localizePage(langCode);
    }
});

// Handle dropdown interactions
dropdownButton.addEventListener('click', () => {
    dropdown.classList.toggle('open');
});

dropdownList.addEventListener('click', event => {
    const selectedItem = event.target.closest('li');
    if (selectedItem) {
        const selectedLang = selectedItem.getAttribute('data-lang');
        localizePage(selectedLang);
        dropdownButton.innerHTML = selectedItem.innerHTML; // Update the button text with selected language and flag
        dropdown.classList.remove('open');
    }
});