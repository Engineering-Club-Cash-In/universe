El servicio web proporcionado atiende una solicitud POST del protocolo HTTP, el cuál recibe cadenas JSON y devuelve un resultado en el mismo formato.

A continuación, se muestra la información necesaria para realizar la conexión del servicio.

	
DOMINIO	https://api.broadcastermobile.com
URL	http://[dominio]/brdcstr-endpoint-web/services/messaging/
METHOD	POST
HEADERS	Content-Type: application/json
Authorization: [token]
Body

{
    "apiKey": [numeric][required],  
    "carrier": [string][optional],  
    "country": [string][required],  
    "dial": [numeric][optional],  
    "message": [String][required],  
    "msisdns": [String[]][required],  
    "tag": [String][required],  
    "mask": [String][optional],  
    "msgClass": [numeric][optional],  
    "schedule":[String][optional][format: ISO-8601],
    "dlr":[Boolean][optional],
    "optionals":[String][optional]
}


Parámetros	Descripción	Obligatorio
dominio	Es la ruta en dónde se encontrará alojado el servicio, esta información será proporcionada por Concepto Móvil.	Si
Authorization	Es un “token” privado que será proporcionado por Concepto Móvil y será utilizado como llave para poder realizer la conexión.	Si
apiKey	Identificador del cliente proporcionado por Concepto Móvil. Es único para cada cliente.	Si
carrier	Nombre del operador al que pertenece el MSISDN al que se le enviará el mensaje. Las posibles opciones a enviar son:

    TELCEL
    ATT
    MOVISTAR


Estas deben ser ingresadas tal como se indica en la lista. Si se negoció Perfilamiento, no es necesario realizar el envío de este parámetro, de este modo la plataforma perfilará los números.	No
country	Identificador del país (ISO2) dos caracteres en mayúsculas.	Si
dial	Número de marcación que se utilizará para enviar el mensaje.	Si
message	Texto a enviar (160 Caracteres). Si se envía un texto de más de 160 caracteres la plataforma concatenará estos mensajes en múltiplos de 153 caracteres. Debe utilizar caracteres soportados por la codificación GSM7 cualquier carácter que no corresponda a esta codificación puede ocasionar que el mensaje no se muestre de forma adecuada.	Si
msisdns	Número con 10 dígitos más lada, al que se le enviará el mensaje, debe ser ingresado ente corchetes.	Si
tag	Texto que sirve para identificar la petición. Abierta para que se envié la cadena deseada por el usuario, se sugiere enviar el nombre de la campaña. Obligatorio	
mask	Texto de la máscara con la que se desea que llegue el mensaje. Para cuando se requiera enmascaramiento, se debe tener acordado previamente la posibilidad de usar esta funcionalidad.	No
schedule	Fecha y hora en la que se enviará el mensaje, debe incluir la zona horaria. Si no se incluye este atributo se programará el envío de forma inmediata.	No
msgClass	Valor que indica si será mensaje normal o mensaje flash Normal 0 y Flash 1). Si no se incluye este atributo se tomará como si fuera cero.	No
dlr	Valor que indica si es requerida la notificación DeliveryReceipt para entregarse hacia una url proporcionada por el cliente. Si s especifica como verdadero, se requiere el dato “registeredDelivery”.	No
optionals	Valor en el cual se asignan variables especificas según se requiera en formato json {“propiedad”:”valor”}

    registeredDelivery: Obligatorio si se especifica el dato “dlr”. Valores permitidos:
        1: Indica cuando el operador ha enviado el MT al dispositivo.
        5: Indica cuando el dispositivo ha recibido el MT.
        11: Indica cuando se ha enviado el MT al operador.

	No

Ejemplo

{  
    "apiKey": 22,  
    "carrier": "Telcel",  
    "country": "mx",  
    "dial": 12345,  
    "message": "Mensaje prueba",  
    "msisdns": [525512345678],  
    "tag": "Tag prueba",  
    "mask": "MASCARA",  
    "schedule": "2018-07-01T10:15:30+01:00",
    "dlr":"true",
    "optionals":"{"registeredDelivery":11}"
}

La respuesta entregada por el servicio es una cadena JSON la cual cambiará de acuerdo al tipo de respuesta, para una respuesta exitosa se mostrará cómo sigue:
Ejemplo respuesta

{  
   "code":0,
   "mailingId":5000384,
   "result":"Applied"
}


	Descripción	
code	Código de resultado, para el exitoso siempre será cero.	0
mailingId	Número que indica la solicitud que fue registrada	5000384
result	Indica el resultado de la solicitud, para el caso exitoso será siempre Applied. Con este dato se determina si la solicitud fue registrada correctamente y así estará en espera de ser atendida.	Applied

Cuando existe algun problema al procesar la solicitud, la cadena JSON sufrirá algunos cambios, a continuación, se muestra la cadena que se recibirá.
Ejemplo respuesta errónea

{ 
   "code":-17,
   "hint":"The country abbreviation or the carrier does not exist",
   "message":"Validation error"
}


	Descripción	
code	Código de resultado, de acuerdo al valor indica el tipo de error ocurrido.	-17
hint	Describe el tipo de error ocurrido	The country abbreviation or the carrier does not exist
message	Identifica, con un nombre, el error ocurrido.	Validation error

Código (errorCode)	Identificador de tipo (message)	Mensaje (hint)
1	Unauthorized access!!!	Unauthorized access!!!
2	Missing configuration error	Some of the fields have null values, which is not correct.
3	Bad authentication	The given authorization information is not valid
4	Missing configuration error	The API Key parameter can not be empty nor zero
5	Missing configuration error	The Carrier parameter can not be empty
6	Missing configuration error	The Country code parameter can not be empty, it should be 2 characters long
7	Missing configuration error	The Message parameter can not be empty
8	Missing configuration error	The msisdn array can not be empty nor null
9	Missing configuration error	The Tag parameter cannot be empty
10	Missing configuration error	Invalid date parameter, must be a future date or an empty field in which case the request is going to be attended immediately
11	Missing configuration error	Malformed date parameter, the format should be dd-MM-yyyy HH:mm:ss
12	Missing configuration error	The Dial parameter is invalid
13	Validation error	Verify your request format
14	Validation error	The client was not found
15	Validation error	The client has not enough credit to complete the operation
16	Validation error	There are many accounts to the client
17	Validation error	The country abbreviation or the carrier does not exists
18	Validation error	The specified dial does not exists or is not assigned to the client
19	Server error	Connection refused
