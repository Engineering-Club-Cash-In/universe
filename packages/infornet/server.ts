import { createInfornetAPI } from './api';

const app = createInfornetAPI();

app.listen(3001);

console.log(`🚀 Infornet API corriendo en http://localhost:${app.server?.port}`);