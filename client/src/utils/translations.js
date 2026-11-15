// client/src/utils/translations.js
import en from './locales/en.js';
import hi from './locales/hi.js';
import mr from './locales/mr.js';
import es from './locales/es.js';
import de from './locales/de.js';
import fr from './locales/fr.js';
import ja from './locales/ja.js';
import pt from './locales/pt.js';
import ar from './locales/ar.js';
import zhCN from './locales/zhCN.js';
import bn from './locales/bn.js';
import ta from './locales/ta.js';

export const TRANSLATIONS = {
  en,
  hi,
  mr,
  es,
  de,
  fr,
  ja,
  pt,
  ar,
  'zh-CN': zhCN,
  bn,
  ta
};

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', bcp47: 'en-US', dir: 'ltr' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', bcp47: 'hi-IN', dir: 'ltr' },
  { code: 'mr', label: 'Marathi', native: 'मराठी', bcp47: 'mr-IN', dir: 'ltr' },
  { code: 'es', label: 'Spanish', native: 'Español', bcp47: 'es-ES', dir: 'ltr' },
  { code: 'de', label: 'German', native: 'Deutsch', bcp47: 'de-DE', dir: 'ltr' },
  { code: 'fr', label: 'French', native: 'Français', bcp47: 'fr-FR', dir: 'ltr' },
  { code: 'ja', label: 'Japanese', native: '日本語', bcp47: 'ja-JP', dir: 'ltr' },
  { code: 'pt', label: 'Portuguese', native: 'Português', bcp47: 'pt-BR', dir: 'ltr' },
  { code: 'ar', label: 'Arabic', native: 'العربية', bcp47: 'ar-SA', dir: 'rtl' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', native: '简体中文', bcp47: 'zh-CN', dir: 'ltr' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', bcp47: 'bn-IN', dir: 'ltr' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்', bcp47: 'ta-IN', dir: 'ltr' },
];

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map(l => l.code);

export const getPersonalizedGreeting = (customerId, lang = 'en') => {
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
  if (customerId === 'cust_aarav' || customerId === 'Aarav Sharma') return t.welcomeAarav;
  if (customerId === 'cust_priya' || customerId === 'Priya Mehta') return t.welcomePriya;
  if (customerId === 'cust_kabir' || customerId === 'Kabir Verma') return t.welcomeKabir;
  return t.welcomeDefault;
};

export const getAssistantIntroMessage = (customerId, lang = 'en') => {
  const intros = {
    cust_aarav: {
      en: "Hello Aarav! I see your order #NC1021 for the NovaSprint Pro Running Shoes is currently delayed at the regional logistics hub. How can we assist you today?",
      hi: "नमस्ते आरव! हम देख सकते हैं कि आपके ऑर्डर #NC1021 (नोवास्प्रिंट प्रो रनिंग शूज) में कूरियर हब पर देरी हो रही है। आज हम आपकी क्या सहायता कर सकते हैं?",
      mr: "नमस्कार आरव! आम्ही पाहू शकतो की आपल्या #NC1021 ऑर्डरमध्ये (नोव्हास्प्रिंट प्रो रनिंग शूज) कूरियर हबवर विलंब झाला आहे. आज आम्ही आपली कशी मदत करू शकतो?",
      es: "¡Hola Aarav! Veo que tu pedido #NC1021 de las zapatillas NovaSprint Pro Running Shoes tiene un retraso en el centro logístico regional. ¿Cómo podemos ayudarte hoy?",
      de: "Hallo Aarav! Ihre Bestellung #NC1021 für die NovaSprint Pro Running Shoes hat derzeit eine Verzögerung im regionalen Logistikzentrum. Wie können wir Ihnen heute helfen?",
      fr: "Bonjour Aarav ! Je constate que votre commande #NC1021 pour les chaussures NovaSprint Pro Running Shoes est actuellement retardée au centre logistique régional. Comment pouvons-nous vous aider aujourd'hui ?",
      ja: "Aarav様、こんにちは。ご注文の #NC1021（NovaSprint Pro Running Shoes）は現在、地域物流拠点にて遅延が発生しております。本日はどのようなサポートが必要でしょうか？",
      pt: "Olá Aarav! Vejo que seu pedido #NC1021 dos tênis NovaSprint Pro Running Shoes está atrasado no centro logístico regional. Como podemos te ajudar hoje?",
      ar: "مرحباً Aarav! أرى أن طلبك رقم #NC1021 الخاص بحذاء NovaSprint Pro Running Shoes متأخر حالياً في المركز اللوجستي الإقليمي. كيف يمكننا مساعدتك اليوم؟",
      'zh-CN': "您好 Aarav！我们看到您的订单 #NC1021（NovaSprint Pro Running Shoes）目前在区域物流枢纽发生延误。今天有什么可以帮您的？",
      bn: "নমস্কার Aarav! আমরা দেখতে পাচ্ছি আপনার অর্ডার #NC1021 (NovaSprint Pro Running Shoes) আঞ্চলিক লজিস্টিক হাবে বিলম্বিত হচ্ছে। আজ আমরা আপনাকে কীভাবে সাহায্য করতে পারি?",
      ta: "வணக்கம் Aarav! NovaSprint Pro Running Shoes-க்கான உங்கள் ஆர்டர் #NC1021 தற்போது பிராந்திய தளவாட மையத்தில் தாமதமாகியுள்ளது. இன்று நாங்கள் உங்களுக்கு எவ்வாறு உதவ முடியும்?"
    },
    cust_priya: {
      en: "Hello Priya! Your order #NC1022 for the NovaPulse Smartwatch was delivered recently. How can we help you today?",
      hi: "नमस्ते प्रिया! आपका ऑर्डर #NC1022 (नोवापल्स स्मार्टवॉच) हाल ही में डिलीवर किया गया है। आज हम आपकी क्या सहायता कर सकते हैं?",
      mr: "नमस्कार प्रिया! आपली ऑर्डर #NC1022 (नोव्हापल्स स्मार्टवॉच) नुकतीच डिलिव्हर झाली आहे. आज आम्ही आपली काय मदत करू शकतो?",
      es: "¡Hola Priya! Tu pedido #NC1022 del smartwatch NovaPulse Smartwatch fue entregado recientemente. ¿En qué podemos ayudarte hoy?",
      de: "Hallo Priya! Ihre Bestellung #NC1022 für die NovaPulse Smartwatch wurde kürzlich zugestellt. Wie können wir Ihnen heute helfen?",
      fr: "Bonjour Priya ! Votre commande #NC1022 pour la montre connectée NovaPulse Smartwatch a été livrée récemment. Comment pouvons-nous vous aider aujourd'hui ?",
      ja: "Priya様、こんにちは。ご注文の #NC1022（NovaPulse Smartwatch）は最近お届け完了となっております。本日はどのようなご用件でしょうか？",
      pt: "Olá Priya! Seu pedido #NC1022 do smartwatch NovaPulse Smartwatch foi entregue recentemente. Como podemos te ajudar hoje?",
      ar: "مرحباً Priya! تم تسليم طلبك رقم #NC1022 الخاص بساعة NovaPulse Smartwatch مؤخراً. كيف يمكننا مساعدتك اليوم؟",
      'zh-CN': "您好 Priya！您的订单 #NC1022（NovaPulse Smartwatch）近期已送达。今天有什么可以帮您的？",
      bn: "নমস্কার Priya! আপনার অর্ডার #NC1022 (NovaPulse Smartwatch) সম্প্রতি ডেলিভার করা হয়েছে। আজ কীভাবে সাহায্য করতে পারি?",
      ta: "வணக்கம் Priya! NovaPulse Smartwatch-க்கான உங்கள் ஆர்டர் #NC1022 சமீபத்தில் டெலிவரி செய்யப்பட்டது. இன்று நாங்கள் எவ்வாறு உதவலாம்?"
    },
    cust_kabir: {
      en: "Hello Kabir! Your order #NC1023 for the NovaBass Wireless ANC Headphones was delivered. How can we help with your package?",
      hi: "नमस्ते कबीर! आपका ऑर्डर #NC1023 (नोवाबॉस वायरलेस एएनसी हेडफ़ोन) डिलीवर हो गया है। कृपया बताएं कि हम आपके पैकेज में क्या मदद कर सकते हैं।",
      mr: "नमस्कार कबीर! आपली ऑर्डर #NC1023 (नोव्हाबास वायरलेस एएनसी हेडफोन्स) डिलिव्हर झाली आहे. कृपया सांगा आम्ही आपल्या पॅकेजमध्ये कशी मदत करू शकतो.",
      es: "¡Hola Kabir! Tu pedido #NC1023 de los auriculares NovaBass Wireless ANC Headphones fue entregado. ¿Cómo podemos ayudarte con tu paquete?",
      de: "Hallo Kabir! Ihre Bestellung #NC1023 für die NovaBass Wireless ANC Headphones wurde zugestellt. Wie können wir Ihnen bei Ihrem Paket helfen?",
      fr: "Bonjour Kabir ! Votre commande #NC1023 pour le casque NovaBass Wireless ANC Headphones a été livrée. Comment pouvons-nous vous aider avec votre colis ?",
      ja: "Kabir様、こんにちは。ご注文の #NC1023（NovaBass Wireless ANC Headphones）はお届け完了いたしました。お荷物に関して何かお手伝いできることはありますか？",
      pt: "Olá Kabir! Seu pedido #NC1023 dos fones NovaBass Wireless ANC Headphones foi entregue. Como podemos ajudar com seu pacote?",
      ar: "مرحباً Kabir! تم تسليم طلبك رقم #NC1023 الخاص بسماعات NovaBass Wireless ANC Headphones. كيف يمكننا مساعدتك في شحنتك؟",
      'zh-CN': "您好 Kabir！您的订单 #NC1023（NovaBass Wireless ANC Headphones）已送达。请问关于您的包裹有什么我们可以协助的？",
      bn: "নমস্কার Kabir! আপনার অর্ডার #NC1023 (NovaBass Wireless ANC Headphones) ডেলিভার হয়েছে। আপনার প্যাকেজ সম্পর্কিত কী সাহায্য করতে পারি?",
      ta: "வணக்கம் Kabir! NovaBass Wireless ANC Headphones-க்கான உங்கள் ஆர்டர் #NC1023 டெலிவரி செய்யப்பட்டது. உங்கள் பார்சல் பற்றி நாங்கள் எவ்வாறு உதவலாம்?"
    }
  };

  const cId = (customerId === 'Aarav Sharma' || customerId === 'cust_aarav') ? 'cust_aarav'
    : (customerId === 'Priya Mehta' || customerId === 'cust_priya') ? 'cust_priya'
    : (customerId === 'Kabir Verma' || customerId === 'cust_kabir') ? 'cust_kabir'
    : customerId;

  return intros[cId]?.[lang] || intros[cId]?.en || "Hello! How can we assist you with your order today?";
};

export const getSuggestedQuestions = (customerId, lang = 'en') => {
  const questions = {
    cust_aarav: {
      en: [
        "Where is my package right now?",
        "Why is delivery delayed past Nov 5?",
        "Can you expedite priority transit?"
      ],
      hi: [
        "मेरा पैकेज अभी कहाँ है?",
        "मेरी डिलीवरी 5 नवंबर से आगे क्यों लेट है?",
        "क्या इसे प्राथमिकता से भेजा जा सकता है?"
      ],
      mr: [
        "माझे पॅकेज सध्या कुठे आहे?",
        "माझी डिलिव्हरी 5 नोव्हेंबर नंतर का उशिरा झाली आहे?",
        "मला प्राधान्याने डिलिव्हरी मिळू शकते का?"
      ],
      es: [
        "¿Dónde está mi paquete en este momento?",
        "¿Por qué se retrasó la entrega después del 5 de nov?",
        "¿Se puede acelerar el tránsito prioritario?"
      ],
      de: [
        "Wo befindet sich mein Paket aktuell?",
        "Warum verzögert sich die Lieferung über den 5. Nov hinaus?",
        "Kann der Versand priorisiert werden?"
      ],
      fr: [
        "Où se trouve mon colis actuellement ?",
        "Pourquoi la livraison est-elle retardée après le 5 nov. ?",
        "Pouvez-vous accélérer l'expédition prioritaire ?"
      ],
      ja: [
        "荷物は現在どこにありますか？",
        "11月5日を過ぎても配送が遅れている理由は何ですか？",
        "優先発送で配送を早めることはできますか？"
      ],
      pt: [
        "Onde está meu pacote agora?",
        "Por que a entrega está atrasada após 5 de nov?",
        "Vocês podem agilizar o trânsito prioritário?"
      ],
      ar: [
        "أين طردي في الوقت الحالي؟",
        "لماذا تأخر التوصيل بعد موعد 5 نوفمبر؟",
        "هل يمكن تسريع الشحن ذو الأولوية؟"
      ],
      'zh-CN': [
        "我的包裹现在在什么位置？",
        "为什么11月5日后配送出现延迟？",
        "能否加急安排优先派送？"
      ],
      bn: [
        "আমার প্যাকেজটি এখন কোথায় আছে?",
        "৫ নভেম্বরের পরেও ডেলিভারি কেন দেরি হচ্ছে?",
        "এটি কি দ্রুত অগ্রাধিকার ভিত্তিতে পাঠানো সম্ভব?"
      ],
      ta: [
        "எனது பார்சல் தற்போது எங்குள்ளது?",
        "நவம்பர் 5க்கு பிறகும் டெலிவரி ஏன் தாமதமாகிறது?",
        "முன்னுரிமை அடிப்படையில் விரைவுபடுத்த முடியுமா?"
      ]
    },
    cust_priya: {
      en: [
        "How do I return this smartwatch?",
        "Am I within the 7-day return window?",
        "Can you generate a prepaid return label?"
      ],
      hi: [
        "मैं यह स्मार्टवॉच कैसे वापस करूँ?",
        "क्या मैं 7-दिन की वापसी अवधि के भीतर हूँ?",
        "क्या आप प्रीपेड रिटर्न लेबल बना सकते हैं?"
      ],
      mr: [
        "मी हे स्मार्टवॉच कसे परत करू?",
        "मी 7-दिवसांच्या रिटर्न कालावधीत आहे का?",
        "तुम्ही प्रीपेड रिटर्न लेबल तयार करू शकता का?"
      ],
      es: [
        "¿Cómo devuelvo este smartwatch?",
        "¿Estoy dentro del plazo de 7 días para devoluciones?",
        "¿Pueden generar una etiqueta prepagada de devolución?"
      ],
      de: [
        "Wie kann ich diese Smartwatch zurücksenden?",
        "Liege ich innerhalb der 7-tägigen Rückgabefrist?",
        "Können Sie ein vorfrankiertes Rücksendeetikett erstellen?"
      ],
      fr: [
        "Comment retourner cette montre connectée ?",
        "Suis-je dans le délai de retour de 7 jours ?",
        "Pouvez-vous générer une étiquette de retour prépayée ?"
      ],
      ja: [
        "このスマートウォッチを返品するにはどうすればよいですか？",
        "7日間の返品期間内ですか？",
        "着払い返品ラベルを発行できますか？"
      ],
      pt: [
        "Como devolver este smartwatch?",
        "Ainda estou no prazo de devolução de 7 dias?",
        "Podem gerar uma etiqueta pré-paga de devolução?"
      ],
      ar: [
        "كيف يمكنني إرجاع هذه الساعة الذكية؟",
        "هل أنا ضمن مهلة الإرجاع المحددة بـ 7 أيام؟",
        "هل يمكنك إنشاء ملصق إرجاع مدفوع مسبقاً؟"
      ],
      'zh-CN': [
        "我该如何办理这款智能手表的退货？",
        "我还在7天无理由退货期内吗？",
        "能否生成预付费退货面单？"
      ],
      bn: [
        "আমি কীভাবে এই স্মার্টওয়াচটি ফেরত দেব?",
        "আমি কি ৭ দিনের রিটার্ন উইন্ডোর মধ্যে আছি?",
        "আপনারা কি একটি প্রি-পেইড রিটার্ন লেবেল তৈরি করতে পারবেন?"
      ],
      ta: [
        "இந்த ஸ்மார்ட்வாட்சை எவ்வாறு திருப்பி அனுப்புவது?",
        "நான் 7 நாள் ரிட்டர்ன் வாய்ப்பிற்குள் உள்ளேனா?",
        "ப்ரீபெய்ட் ரிட்டர்ன் லேபிளை உருவாக்க முடியுமா?"
      ]
    },
    cust_kabir: {
      en: [
        "I need help setting up ANC mode",
        "How long does the battery last with ANC on?",
        "Can I connect to two devices simultaneously?"
      ],
      hi: [
        "मुझे एएनसी मोड सेट करने में मदद चाहिए",
        "एएनसी चालू रहने पर बैटरी कितने समय तक चलती है?",
        "क्या मैं इसे एक साथ दो डिवाइस से जोड़ सकता हूँ?"
      ],
      mr: [
        "मला एएनसी मोड सेट करण्यासाठी मदत हवी आहे",
        "एएनसी चालू असताना बॅटरी किती वेळ चालते?",
        "मी एकाच वेळी दोन उपकरणांशी कनेक्ट करू शकतो का?"
      ],
      es: [
        "Necesito ayuda para configurar el modo ANC",
        "¿Cuánto dura la batería con la cancelación de ruido activada?",
        "¿Puedo conectarlo a dos dispositivos simultáneamente?"
      ],
      de: [
        "Ich brauche Hilfe bei der Einrichtung des ANC-Modus",
        "Wie lange hält der Akku bei aktiviertem ANC?",
        "Kann ich mich mit zwei Geräten gleichzeitig verbinden?"
      ],
      fr: [
        "J'ai besoin d'aide pour configurer le mode ANC",
        "Quelle est l'autonomie de la batterie avec l'ANC activé ?",
        "Puis-je me connecter à deux appareils simultanément ?"
      ],
      ja: [
        "ANCモードの設定を手伝ってください",
        "ANCを有効にした場合のバッテリー駆動時間はどのくらいですか？",
        "同時に2台のデバイスに接続できますか？"
      ],
      pt: [
        "Preciso de ajuda para configurar o modo ANC",
        "Quanto tempo dura a bateria com o ANC ativado?",
        "Posso conectar em dois dispositivos simultaneamente?"
      ],
      ar: [
        "أحتاج مساعدة في ضبط وضع عزل الضوضاء ANC",
        "كم تدوم البطارية مع تشغيل وضع عزل الضوضاء؟",
        "هل يمكنني الاتصال بجهازين في نفس الوقت؟"
      ],
      'zh-CN': [
        "我需要协助设置主动降噪(ANC)模式",
        "开启ANC降噪后电池能使用多久？",
        "能否同时连接两台蓝牙设备？"
      ],
      bn: [
        "আমার এএনসি মোড সেট আপ করতে সাহায্য প্রয়োজন",
        "এএনসি চালু থাকলে ব্যাটারি কতক্ষণ চলে?",
        "আমি কি একসাথে দুটি ডিভাইসের সাথে কানেক্ট করতে পারব?"
      ],
      ta: [
        "ANC பயன்முறையை அமைக்க உதவி தேவை",
        "ANC இயக்கப்பட்டிருக்கும் போது பேட்டரி எவ்வளவு நேரம் நீடிக்கும்?",
        "ஒரே நேரத்தில் இரண்டு சாதனங்களுடன் இணைக்க முடியுமா?"
      ]
    }
  };

  const cId = (customerId === 'Aarav Sharma' || customerId === 'cust_aarav') ? 'cust_aarav'
    : (customerId === 'Priya Mehta' || customerId === 'cust_priya') ? 'cust_priya'
    : (customerId === 'Kabir Verma' || customerId === 'cust_kabir') ? 'cust_kabir'
    : customerId;

  return questions[cId]?.[lang] || questions[cId]?.en || [];
};

export default {
  TRANSLATIONS,
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  getPersonalizedGreeting,
  getAssistantIntroMessage,
  getSuggestedQuestions
};
