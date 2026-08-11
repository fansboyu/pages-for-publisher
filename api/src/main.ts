import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
async function bootstrap(){const app=await NestFactory.create(AppModule);const origins=(process.env.CORS_ORIGIN??'').split(',').map(x=>x.trim()).filter(Boolean);if(origins.length)app.enableCors({origin:origins,methods:['GET','POST','PUT','DELETE'],allowedHeaders:['Content-Type','Authorization']});app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));await app.listen(Number(process.env.PORT??3000),'0.0.0.0')}bootstrap()
