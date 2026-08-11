import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AdminController, AuthController, HealthController, PortalController, WebhookController } from './controllers'
import { Article, BuildJob, Category, Client, RefreshToken, Site, SiteCredential, User } from './entities'
import { AccessService, AdminService, AuthService, BuildWorker, ContentService, JOB_QUEUE } from './services'
@Module({imports:[ConfigModule.forRoot({isGlobal:true}),JwtModule.registerAsync({inject:[ConfigService],useFactory:(c:ConfigService)=>({secret:c.getOrThrow('JWT_SECRET')})}),TypeOrmModule.forRootAsync({inject:[ConfigService],useFactory:(c:ConfigService)=>({type:'postgres',url:c.getOrThrow('DATABASE_URL'),entities:[Client,User,RefreshToken,Site,SiteCredential,Category,Article,BuildJob],synchronize:true})}),TypeOrmModule.forFeature([Client,User,RefreshToken,Site,SiteCredential,Category,Article,BuildJob]),BullModule.forRootAsync({inject:[ConfigService],useFactory:(c:ConfigService)=>({connection:{url:c.getOrThrow('REDIS_URL')}})}),BullModule.registerQueue({name:JOB_QUEUE})],controllers:[HealthController,AuthController,AdminController,PortalController,WebhookController],providers:[AuthService,AccessService,AdminService,ContentService,...(process.env.RUN_WORKER==='true'?[BuildWorker]:[])]}) export class AppModule {}
