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
    },
    runningLineString: {
        "en": "We have developed a dedicated website that empowers every internet user with the essential ability to seamlessly transfer files between devices, backed by robust protection against data theft and unauthorized access.",
        "es": "Hemos desarrollado un sitio web dedicado que ofrece a cada usuario de Internet la capacidad esencial de transferir archivos entre dispositivos de manera fluida, respaldado por una sólida protección contra el robo de datos y el acceso no autorizado.",
        "fr": "Nous avons développé un site Web dédié qui offre à chaque utilisateur d'Internet la capacité essentielle de transférer des fichiers entre appareils de manière fluide, avec une protection robuste contre le vol de données et les accès non autorisés.",
        "de": "Wir haben eine dedizierte Website entwickelt, die jedem Internetnutzer die wesentliche Fähigkeit bietet, Dateien nahtlos zwischen Geräten zu übertragen, mit robuster Sicherheit gegen Datendiebstahl und unbefugten Zugriff.",
        "zh": "我们开发了一个专门的网站，使每位互联网用户能够无缝地在设备之间传输文件，并提供强大的数据盗窃和未经授权访问保护。",
        "ru": "Мы разработали специализированный веб-сайт, который предоставляет каждому интернет-пользователю важную возможность беспрепятственно передавать файлы между устройствами, с надежной защитой от кражи данных и несанкционированного доступа.",
        "ja": "私たちは、すべてのインターネットユーザーがデバイス間でファイルをシームレスに転送するための重要な機能を備えた専用のウェブサイトを開発しました。データ盗難や不正アクセスに対する強力な保護も備えています。",
        "it": "Abbiamo sviluppato un sito web dedicato che offre a ogni utente di Internet la capacità essenziale di trasferire file tra dispositivi senza problemi, con una protezione robusta contro il furto di dati e l'accesso non autorizzato.",
        "pt": "Criamos um site dedicado que oferece a todos os usuários da Internet a capacidade essencial de transferir arquivos entre dispositivos de forma contínua, com proteção robusta contra roubo de dados e acesso não autorizado.",
        "ar": "لقد قمنا بتطوير موقع ويب مخصص يمنح كل مستخدم للإنترنت القدرة الأساسية على نقل الملفات بين الأجهزة بسلاسة، مع حماية قوية ضد سرقة البيانات والوصول غير المصرح به.",
        "hi": "हमने एक समर्पित वेबसाइट विकसित की है जो हर इंटरनेट उपयोगकर्ता को उपकरणों के बीच निर्बाध रूप से फाइलें स्थानांतरित करने की महत्वपूर्ण क्षमता प्रदान करती है, साथ ही डेटा चोरी और अनधिकृत पहुंच के खिलाफ मजबूत सुरक्षा प्रदान करती है।",
        "ko": "우리는 모든 인터넷 사용자가 장치 간 파일을 원활하게 전송할 수 있는 필수 기능을 제공하는 전용 웹사이트를 개발했으며, 데이터 도난 및 무단 액세스로부터 강력하게 보호합니다.",
        "tr": "Her internet kullanıcısına cihazlar arasında dosya aktarımı yapma yeteneğini kazandıran ve veri hırsızlığına ve yetkisiz erişime karşı güçlü bir koruma sunan özel bir web sitesi geliştirdik.",
        "nl": "We hebben een speciale website ontwikkeld die elke internetgebruiker de essentiële mogelijkheid biedt om naadloos bestanden tussen apparaten over te dragen, ondersteund door robuuste bescherming tegen gegevensdiefstal en ongeautoriseerde toegang.",
        "sv": "Vi har utvecklat en dedikerad webbplats som ger varje internetanvändare den viktiga möjligheten att sömlöst överföra filer mellan enheter, med ett starkt skydd mot datastöld och obehörig åtkomst.",
        "pl": "Stworzyliśmy dedykowaną stronę internetową, która zapewnia każdemu użytkownikowi internetu możliwość płynnego przesyłania plików między urządzeniami, chronioną przed kradzieżą danych i nieautoryzowanym dostępem.",
        "vi": "Chúng tôi đã phát triển một trang web chuyên dụng cung cấp cho mọi người dùng internet khả năng chuyển tệp giữa các thiết bị một cách liền mạch, được hỗ trợ bởi sự bảo vệ mạnh mẽ chống lại trộm cắp dữ liệu và truy cập trái phép.",
        "id": "Kami telah mengembangkan situs web khusus yang memungkinkan setiap pengguna internet untuk mentransfer file antar perangkat secara mulus, didukung oleh perlindungan kuat terhadap pencurian data dan akses tidak sah.",
        "th": "เราได้พัฒนาเว็บไซต์เฉพาะที่มอบความสามารถสำคัญในการถ่ายโอนไฟล์ระหว่างอุปกรณ์ได้อย่างราบรื่น พร้อมการป้องกันข้อมูลสูญหายและการเข้าถึงที่ไม่ได้รับอนุญาตอย่างแข็งแกร่ง",
        "uk": "Ми розробили спеціалізований веб-сайт, який надає кожному інтернет-користувачу важливу можливість безперешкодно передавати файли між пристроями з надійним захистом від крадіжки даних та несанкціонованого доступу.",
        "ms": "Kami telah membangunkan laman web khas yang memberi setiap pengguna internet keupayaan penting untuk memindahkan fail antara peranti secara lancar, disokong oleh perlindungan kukuh terhadap kecurian data dan akses tanpa kebenaran.",
        "tl": "Nilikha namin ang isang dedikadong website na nagbibigay sa bawat gumagamit ng internet ng mahalagang kakayahang maglipat ng mga file sa pagitan ng mga device nang walang abala, na sinusuportahan ng matatag na proteksyon laban sa pagnanakaw ng data at hindi awtorisadong pag-access.",
        "fa": "ما یک وب‌سایت اختصاصی طراحی کرده‌ایم که به هر کاربر اینترنت این امکان را می‌دهد که فایل‌ها را به‌صورت یکپارچه بین دستگاه‌ها منتقل کند و از داده‌ها در برابر سرقت و دسترسی غیرمجاز محافظت کند.",
        "ro": "Am dezvoltat un site web dedicat care oferă fiecărui utilizator de internet capacitatea esențială de a transfera fișiere între dispozitive fără probleme, cu protecție robustă împotriva furtului de date și accesului neautorizat.",
        "hu": "Kifejlesztettünk egy dedikált weboldalt, amely minden internetfelhasználónak lehetővé teszi a fájlok zökkenőmentes átvitelét az eszközök között, erős védelmet nyújtva az adatlopás és az illetéktelen hozzáférés ellen.",
        "cs": "Vyvinuli jsme speciální webovou stránku, která umožňuje každému uživateli internetu snadno přenášet soubory mezi zařízeními, s robustní ochranou proti krádeži dat a neoprávněnému přístupu.",
        "el": "Έχουμε αναπτύξει έναν ειδικό ιστότοπο που παρέχει σε κάθε χρήστη του διαδικτύου τη βασική δυνατότητα μεταφοράς αρχείων μεταξύ συσκευών, με ισχυρή προστασία κατά της κλοπής δεδομένων και της μη εξουσιοδοτημένης πρόσβασης.",
        "da": "Vi har udviklet en dedikeret hjemmeside, der giver alle internetbrugere den essentielle mulighed for problemfrit at overføre filer mellem enheder, med robust beskyttelse mod datatyveri og uautoriseret adgang.",
        "fi": "Olemme kehittäneet erityisen verkkosivuston, joka tarjoaa jokaiselle internetin käyttäjälle olennaisen mahdollisuuden siirtää tiedostoja laitteiden välillä saumattomasti, vahvalla suojalla tietovarkauksia ja luvattomia pääsyjä vastaan.",
        "no": "Vi har utviklet et dedikert nettsted som gir alle internettbrukere muligheten til å overføre filer sømløst mellom enheter, med solid beskyttelse mot datatyveri og uautorisert tilgang."
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

    const runningLine = document.getElementById('runningLine');
    if (runningLine) {
        runningLine.innerText = translations.runningLineString[lang] || translations.runningLineString['en'];
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